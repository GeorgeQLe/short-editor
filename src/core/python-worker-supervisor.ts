import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { AppError } from "../shared/errors.js";
import {
  DEFAULT_WORKER_MAX_FRAME_BYTES,
  PYTHON_WORKER_PROTOCOL_VERSION,
  encodeWorkerFrame,
  pythonWorkerCommandSchema,
  pythonWorkerEventSchema,
  pythonWorkerResultDataSchema,
  type PythonWorkerCommand,
  type PythonWorkerEvent,
  type PythonWorkerJob,
  type PythonWorkerResultData,
  type WorkerOperationKind
} from "../shared/python-worker-protocol.js";

export interface PythonWorkerLaunch {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface PythonWorkerSupervisorOptions {
  launch: PythonWorkerLaunch;
  coreVersion: string;
  maxFrameBytes?: number;
  startupTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
  jobTimeoutMs?: number;
  cancellationGraceMs?: number;
  shutdownGraceMs?: number;
  maximumRestarts?: number;
  onDiagnostic?: (message: string) => void;
}

export interface WorkerSnapshot {
  workerVersion: string;
  capabilities: ReadonlyArray<{
    operation: WorkerOperationKind;
    available: boolean;
    providers: string[];
    features: string[];
  }>;
  status: {
    state: "ready" | "degraded" | "unavailable";
    activeJobIds: string[];
    dependencies: Array<{
      id: string;
      state: "available" | "missing" | "downloading" | "error";
      version: string | null;
      detail: string | null;
    }>;
  };
}

type ActiveJob = {
  kind: PythonWorkerJob["kind"];
  resolve: (result: PythonWorkerResultData) => void;
  reject: (error: AppError) => void;
  timeout: NodeJS.Timeout;
  onProgress?: (progress: number, stage: string) => void;
};

export class PythonWorkerSupervisor extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private snapshot?: WorkerSnapshot;
  private buffer = Buffer.alloc(0);
  private lastHeartbeatAt = 0;
  private heartbeatTimer?: NodeJS.Timeout;
  private restartTimer?: NodeJS.Timeout;
  private restartCount = 0;
  private stopping = false;
  private starting?: Promise<WorkerSnapshot>;
  private activeJobs = new Map<string, ActiveJob>();
  private requestWaiters = new Map<string, {
    resolve: (event: PythonWorkerEvent) => void;
    reject: (error: AppError) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(private readonly options: PythonWorkerSupervisorOptions) {
    super();
    assertCredentialFreeLaunch(options.launch);
  }

  get state(): "stopped" | "starting" | "ready" {
    if (this.starting) return "starting";
    return this.child && this.snapshot ? "ready" : "stopped";
  }

  get currentSnapshot(): WorkerSnapshot | undefined {
    return this.snapshot ? structuredClone(this.snapshot) : undefined;
  }

  start(): Promise<WorkerSnapshot> {
    if (this.snapshot) return Promise.resolve(structuredClone(this.snapshot));
    if (this.starting) return this.starting;
    this.stopping = false;
    this.starting = this.launch();
    void this.starting.finally(() => { this.starting = undefined; }).catch(() => undefined);
    return this.starting;
  }

  async capabilities(): Promise<WorkerSnapshot["capabilities"]> {
    await this.start();
    const event = await this.request({
      protocolVersion: PYTHON_WORKER_PROTOCOL_VERSION,
      type: "capabilities.get",
      requestId: randomUUID()
    }, "capabilities");
    if (event.type !== "capabilities") throw invalidOutput("Worker returned the wrong capabilities response");
    return event.capabilities;
  }

  async status(): Promise<WorkerSnapshot["status"]> {
    await this.start();
    const event = await this.request({
      protocolVersion: PYTHON_WORKER_PROTOCOL_VERSION,
      type: "status.get",
      requestId: randomUUID()
    }, "status");
    if (event.type !== "status") throw invalidOutput("Worker returned the wrong status response");
    if (this.snapshot) this.snapshot.status = event.status;
    return event.status;
  }

  runJob(
    jobId: string,
    job: PythonWorkerJob,
    onProgress?: (progress: number, stage: string) => void
  ): Promise<PythonWorkerResultData> {
    if (this.activeJobs.has(jobId)) {
      return Promise.reject(new AppError("INVALID_STATE", "The worker job is already active", 409));
    }
    return new Promise<PythonWorkerResultData>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.activeJobs.delete(jobId);
        reject(new AppError("PROVIDER_UNAVAILABLE", "The worker job timed out", 503));
        this.forceRestart();
      }, this.options.jobTimeoutMs ?? 30 * 60_000);
      this.activeJobs.set(jobId, { kind: job.kind, resolve, reject, timeout, onProgress });
      void this.start().then(() => {
        if (!this.activeJobs.has(jobId)) return;
        this.send({
            protocolVersion: PYTHON_WORKER_PROTOCOL_VERSION,
            type: "job.start",
            requestId: randomUUID(),
            jobId,
            job
          });
      }).catch((error: unknown) => {
        this.settleJob(
          jobId,
          error instanceof AppError ? error : unavailable("Could not send the worker job")
        );
      });
    });
  }

  async cancel(jobId: string): Promise<void> {
    const active = this.activeJobs.get(jobId);
    if (!active) return;
    this.send({
      protocolVersion: PYTHON_WORKER_PROTOCOL_VERSION,
      type: "job.cancel",
      requestId: randomUUID(),
      jobId
    });
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new AppError("PROVIDER_UNAVAILABLE", "The worker did not acknowledge cancellation", 503));
        this.forceRestart();
      }, this.options.cancellationGraceMs ?? 2_000);
      const settled = () => {
        clearTimeout(deadline);
        resolve();
      };
      const originalResolve = active.resolve;
      const originalReject = active.reject;
      active.resolve = (result) => { originalResolve(result); settled(); };
      active.reject = (error) => { originalReject(error); settled(); };
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.stopHeartbeat();
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const child = this.child;
    if (!child) return;
    const requestId = randomUUID();
    const completed = this.request({
      protocolVersion: PYTHON_WORKER_PROTOCOL_VERSION,
      type: "shutdown",
      requestId
    }, "shutdown.complete", this.options.shutdownGraceMs ?? 1_000).catch(() => undefined);
    await completed;
    if (this.child === child && child.exitCode === null) child.kill();
    this.clearChild(child);
  }

  private launch(): Promise<WorkerSnapshot> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const helloRequestId = randomUUID();
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(this.options.launch.command, this.options.launch.args, {
          cwd: this.options.launch.cwd,
          env: this.options.launch.env ?? process.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
      } catch {
        reject(dependencyUnavailable());
        return;
      }
      this.child = child;
      this.buffer = Buffer.alloc(0);
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.off("protocol", onReady);
        this.off("protocolError", onProtocolError);
        child.kill();
        reject(this.buffer.byteLength
          ? invalidOutput("Python worker emitted a partial startup frame")
          : dependencyUnavailable("The Python worker did not complete startup"));
      }, this.options.startupTimeoutMs ?? 10_000);
      const failStartup = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.off("protocol", onReady);
        this.off("protocolError", onProtocolError);
        reject(this.buffer.byteLength
          ? invalidOutput("Python worker emitted a partial startup frame")
          : dependencyUnavailable());
      };
      child.once("error", failStartup);
      child.stdout.on("data", (chunk: Buffer) => this.consume(chunk));
      child.stderr.on("data", () => this.options.onDiagnostic?.("[python worker stderr redacted]"));
      child.once("exit", () => {
        failStartup();
        this.handleExit(child);
      });
      const onReady = (event: PythonWorkerEvent) => {
        if (event.type !== "ready" || settled) return;
        if (event.requestId !== helloRequestId) {
          this.protocolFailure("Worker ready response did not match the startup request");
          return;
        }
        settled = true;
        clearTimeout(timeout);
        this.off("protocol", onReady);
        this.off("protocolError", onProtocolError);
        this.snapshot = {
          workerVersion: event.workerVersion,
          capabilities: event.capabilities,
          status: event.status
        };
        this.lastHeartbeatAt = Date.now();
        this.startHeartbeat();
        resolve(structuredClone(this.snapshot));
      };
      const onProtocolError = (error: AppError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.off("protocol", onReady);
        this.off("protocolError", onProtocolError);
        if (child.exitCode === null) child.kill();
        reject(error);
      };
      this.on("protocol", onReady);
      this.on("protocolError", onProtocolError);
      this.send({
        protocolVersion: PYTHON_WORKER_PROTOCOL_VERSION,
        type: "hello",
        requestId: helloRequestId,
        coreVersion: this.options.coreVersion
      });
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const maximum = this.options.maxFrameBytes ?? DEFAULT_WORKER_MAX_FRAME_BYTES;
    while (true) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) {
        if (this.buffer.byteLength > maximum) this.protocolFailure("Worker frame exceeded the size limit");
        return;
      }
      if (newline > maximum) {
        this.protocolFailure("Worker frame exceeded the size limit");
        return;
      }
      const frame = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      if (!frame.byteLength) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(frame.toString("utf8"));
      } catch {
        this.protocolFailure("Worker emitted malformed JSON");
        return;
      }
      const validated = pythonWorkerEventSchema.safeParse(parsed);
      if (!validated.success) {
        this.protocolFailure("Worker emitted a message that failed protocol validation");
        return;
      }
      this.dispatch(validated.data);
    }
  }

  private dispatch(event: PythonWorkerEvent): void {
    this.emit("protocol", event);
    if (event.type === "heartbeat") {
      this.lastHeartbeatAt = Date.now();
      return;
    }
    if ("requestId" in event && event.requestId) {
      const waiter = this.requestWaiters.get(event.requestId);
      if (waiter) {
        clearTimeout(waiter.timeout);
        this.requestWaiters.delete(event.requestId);
        if (event.type === "error") waiter.reject(workerError(event));
        else waiter.resolve(event);
      }
    }
    if (!("jobId" in event) || !event.jobId) return;
    const active = this.activeJobs.get(event.jobId);
    if (!active) return;
    if (event.type === "job.progress") {
      active.onProgress?.(event.progress, event.stage);
      return;
    }
    if (event.type === "job.result") {
      if (event.result.kind !== active.kind || !pythonWorkerResultDataSchema.safeParse(event.result).success) {
        this.settleJob(event.jobId, invalidOutput("Worker result did not match the requested operation"));
      } else {
        this.settleJob(event.jobId, undefined, event.result);
      }
    } else if (event.type === "job.cancelled") {
      this.settleJob(event.jobId, new AppError("JOB_CANCELLED", "Worker job cancelled", 409));
    } else if (event.type === "error") {
      this.settleJob(event.jobId, workerError(event));
    }
  }

  private settleJob(jobId: string, error?: AppError, result?: PythonWorkerResultData): void {
    const active = this.activeJobs.get(jobId);
    if (!active) return;
    clearTimeout(active.timeout);
    this.activeJobs.delete(jobId);
    if (error) active.reject(error);
    else active.resolve(result!);
  }

  private request(
    command: PythonWorkerCommand & { requestId: string },
    expectedType: PythonWorkerEvent["type"],
    timeoutMs = 5_000
  ): Promise<PythonWorkerEvent> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requestWaiters.delete(command.requestId);
        reject(unavailable(`Worker did not answer ${command.type}`));
      }, timeoutMs);
      this.requestWaiters.set(command.requestId, {
        timeout,
        reject,
        resolve: (event) => {
          if (event.type !== expectedType) reject(invalidOutput("Worker returned an unexpected response"));
          else resolve(event);
        }
      });
      try {
        this.send(command);
      } catch (error) {
        clearTimeout(timeout);
        this.requestWaiters.delete(command.requestId);
        reject(error);
      }
    });
  }

  private send(command: PythonWorkerCommand): void {
    const parsed = pythonWorkerCommandSchema.parse(command);
    const child = this.child;
    if (!child || child.stdin.destroyed) throw unavailable("Python worker is not running");
    const frame = encodeWorkerFrame(parsed);
    if (frame.byteLength > (this.options.maxFrameBytes ?? DEFAULT_WORKER_MAX_FRAME_BYTES)) {
      throw invalidOutput("Core worker command exceeded the framing limit");
    }
    child.stdin.write(frame);
  }

  private protocolFailure(message: string): void {
    const error = invalidOutput(message);
    this.emit("protocolError", error);
    this.rejectAll(error);
    this.options.onDiagnostic?.("[python worker protocol failure]");
    this.forceRestart();
  }

  private handleExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    const partialFrame = this.buffer.byteLength > 0;
    this.clearChild(child);
    this.rejectAll(partialFrame
      ? invalidOutput("Python worker exited after emitting a partial frame")
      : unavailable("Python worker exited unexpectedly"));
    if (!this.stopping && this.restartCount < (this.options.maximumRestarts ?? 2)) {
      this.restartCount += 1;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined;
        if (!this.stopping) void this.start().catch(() => undefined);
      }, Math.min(250 * this.restartCount, 1_000));
    }
  }

  private forceRestart(): void {
    const child = this.child;
    if (child && child.exitCode === null) child.kill();
    if (child) this.handleExit(child);
  }

  private clearChild(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return;
    this.stopHeartbeat();
    this.child = undefined;
    this.snapshot = undefined;
    this.buffer = Buffer.alloc(0);
  }

  private rejectAll(error: AppError): void {
    for (const [jobId] of this.activeJobs) this.settleJob(jobId, error);
    for (const [requestId, waiter] of this.requestWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
      this.requestWaiters.delete(requestId);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const timeout = this.options.heartbeatTimeoutMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastHeartbeatAt > timeout) {
        this.rejectAll(unavailable("Python worker heartbeat timed out"));
        this.forceRestart();
      }
    }, Math.max(50, Math.floor(timeout / 3)));
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }
}

export function developmentPythonWorkerLaunch(
  repositoryRoot: string,
  pythonCommand = process.platform === "win32" ? "python" : "python3"
): PythonWorkerLaunch {
  return {
    command: pythonCommand,
    args: ["-u", "-B", join(repositoryRoot, "resources", "worker", "worker.py")]
  };
}

export function packagedPythonWorkerLaunch(resourcesPath: string): PythonWorkerLaunch {
  const executable = process.platform === "win32" ? "short-editor-worker.exe" : "short-editor-worker";
  const command = join(resourcesPath, "worker", executable);
  return { command, args: [] };
}

export function assertCredentialFreeLaunch(launch: PythonWorkerLaunch): void {
  const unsafe = launch.args.some((argument) =>
    /(^|[-_])(api[-_]?key|token|secret|password|authorization)(=|$)/i.test(argument) ||
    /^(sk|sess)-[a-z0-9_-]{8,}$/i.test(argument)
  );
  if (unsafe) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Worker credentials must never be passed in command arguments",
      422
    );
  }
}

function workerError(event: Extract<PythonWorkerEvent, { type: "error" }>): AppError {
  const messages = {
    DEPENDENCY_UNAVAILABLE: "A worker dependency is unavailable",
    PROVIDER_UNAVAILABLE: "The selected provider is unavailable",
    PROVIDER_OUTPUT_INVALID: "The provider returned invalid output",
    JOB_CANCELLED: "Worker job cancelled",
    INTERNAL_ERROR: "The worker failed unexpectedly"
  } as const;
  return new AppError(event.code, messages[event.code], undefined, undefined, event.retryable);
}

function invalidOutput(message: string): AppError {
  return new AppError("PROVIDER_OUTPUT_INVALID", message, 422);
}

function unavailable(message = "Python worker is unavailable"): AppError {
  return new AppError("PROVIDER_UNAVAILABLE", message, 503);
}

function dependencyUnavailable(message = "Python runtime or worker dependency is unavailable"): AppError {
  return new AppError("DEPENDENCY_UNAVAILABLE", message, 503);
}
