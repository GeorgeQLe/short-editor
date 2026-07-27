#!/usr/bin/env python3
"""Short Editor v1 local provider worker.

The worker never opens application storage and never downloads a model. Local
faster-whisper models are resolved to an existing directory before the provider
is invoked with ``local_files_only=True``.
"""

import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import threading
import time

PROTOCOL_VERSION = "v1"
WORKER_VERSION = "0.2.0"
DEFAULT_MODEL_IDS = ("small.en",)
active_jobs = {}
active_lock = threading.Lock()
send_lock = threading.Lock()
running = True


def send(message):
    with send_lock:
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def configured_model_ids():
    configured = os.environ.get("SHORT_EDITOR_WHISPER_MODEL_IDS", "")
    values = [value.strip() for value in configured.split(",") if value.strip()]
    return tuple(dict.fromkeys(values or DEFAULT_MODEL_IDS))


def model_roots():
    configured = os.environ.get("SHORT_EDITOR_WHISPER_MODEL_DIR")
    if configured:
        return (Path(configured).expanduser(),)
    cache = os.environ.get("HUGGINGFACE_HUB_CACHE")
    if cache:
        return (Path(cache).expanduser(),)
    home = os.environ.get("HF_HOME")
    if home:
        return (Path(home).expanduser() / "hub",)
    return (Path.home() / ".cache" / "huggingface" / "hub",)


def is_model_directory(path):
    return path.is_dir() and (path / "model.bin").is_file()


def resolve_model_path(model_id):
    identifier = Path(model_id)
    if identifier.is_absolute() or ".." in identifier.parts or "\\" in model_id:
        return None
    cache_name = "models--" + model_id.replace("/", "--")
    aliases = (
        model_id,
        "faster-whisper-" + model_id,
        cache_name,
        "models--Systran--faster-whisper-" + model_id,
    )
    for root in model_roots():
        for alias in aliases:
            candidate = root / alias
            if is_model_directory(candidate):
                return candidate
            snapshots = candidate / "snapshots"
            if snapshots.is_dir():
                for snapshot in sorted(snapshots.iterdir(), reverse=True):
                    if is_model_directory(snapshot):
                        return snapshot
    return None


def faster_whisper_state():
    try:
        from faster_whisper import WhisperModel  # noqa: F401
        try:
            version = importlib.metadata.version("faster-whisper")
        except importlib.metadata.PackageNotFoundError:
            version = "development"
        return True, version
    except (ImportError, OSError):
        return False, None


def dependencies():
    available, version = faster_whisper_state()
    values = [
        {
            "id": "faster-whisper",
            "state": "available" if available else "missing",
            "version": version,
            "detail": None if available else "Install the local faster-whisper worker dependency",
        }
    ]
    for model_id in configured_model_ids():
        installed = resolve_model_path(model_id) is not None
        values.append(
            {
                "id": "faster-whisper:model:" + model_id,
                "state": "available" if installed else "missing",
                "version": None,
                "detail": None if installed else "Install this model in the configured local model directory",
            }
        )
    return values


def status():
    current_dependencies = dependencies()
    ready = all(item["state"] == "available" for item in current_dependencies)
    with active_lock:
        job_ids = sorted(active_jobs)
    return {
        "state": "ready" if ready else "degraded",
        "activeJobIds": job_ids,
        "dependencies": current_dependencies,
    }


def capabilities():
    package_available, _ = faster_whisper_state()
    model_available = any(resolve_model_path(model_id) for model_id in configured_model_ids())
    transcription_available = package_available and model_available
    return [
        {
            "operation": "transcription",
            "available": transcription_available,
            "providers": ["faster-whisper"] if transcription_available else [],
            "features": ["english", "segments", "word-timestamps", "no-diarization"]
            if transcription_available
            else [],
        },
        *[
            {
                "operation": operation,
                "available": False,
                "providers": [],
                "features": [],
            }
            for operation in ("diarization", "visual_sampling", "provider_call")
        ],
    ]


def heartbeat():
    sequence = 0
    while running:
        send(
            {
                "protocolVersion": PROTOCOL_VERSION,
                "type": "heartbeat",
                "sequence": sequence,
                "sentAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        sequence += 1
        time.sleep(2)


def error(request_id, job_id, code, message, retryable):
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "error",
            "requestId": request_id,
            "jobId": job_id,
            "code": code,
            "message": message,
            "retryable": retryable,
        }
    )


def progress(job_id, value, stage):
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "job.progress",
            "jobId": job_id,
            "progress": max(0.0, min(1.0, value)),
            "stage": stage,
        }
    )


def milliseconds(value):
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("Non-finite timestamp")
    return max(0, round(numeric * 1000))


def confidence_from_log_probability(value):
    if value is None:
        return None
    numeric = float(value)
    if not math.isfinite(numeric):
        return None
    return max(0.0, min(1.0, math.exp(numeric)))


def normalize_word(word, segment_start, segment_end, prior_end):
    text = str(getattr(word, "word", "")).strip()
    start = max(segment_start, milliseconds(getattr(word, "start")))
    end = min(segment_end, milliseconds(getattr(word, "end")))
    start = max(start, prior_end)
    if not text or end <= start:
        return None
    probability = getattr(word, "probability", None)
    confidence = None if probability is None else max(0.0, min(1.0, float(probability)))
    return {
        "startMs": start,
        "endMs": end,
        "text": text,
        "confidence": confidence,
    }


def transcribe(job_id, request_id, job, cancelled):
    model_id = job["modelId"]
    model_path = resolve_model_path(model_id)
    if model_path is None:
        error(
            request_id,
            job_id,
            "DEPENDENCY_UNAVAILABLE",
            "The selected faster-whisper model is not installed locally",
            False,
        )
        return
    try:
        from faster_whisper import WhisperModel
    except (ImportError, OSError):
        error(
            request_id,
            job_id,
            "DEPENDENCY_UNAVAILABLE",
            "The faster-whisper worker dependency is not installed",
            False,
        )
        return

    progress(job_id, 0.02, "loading local transcription model")
    try:
        model = WhisperModel(
            str(model_path),
            device=os.environ.get("SHORT_EDITOR_WHISPER_DEVICE", "auto"),
            compute_type=os.environ.get("SHORT_EDITOR_WHISPER_COMPUTE_TYPE", "default"),
            local_files_only=True,
        )
    except Exception:
        error(
            request_id,
            job_id,
            "DEPENDENCY_UNAVAILABLE",
            "The selected faster-whisper model could not be loaded locally",
            False,
        )
        return
    if cancelled.is_set():
        send_cancelled(job_id)
        return

    progress(job_id, 0.08, "decoding local audio")
    try:
        generated, info = model.transcribe(
            job["sourcePath"],
            language="en",
            word_timestamps=job["wordTimestamps"],
            vad_filter=True,
        )
        duration = float(getattr(info, "duration", 0) or 0)
        segments = []
        words = []
        prior_segment_end = 0
        for raw_segment in generated:
            if cancelled.is_set():
                send_cancelled(job_id)
                return
            text = str(getattr(raw_segment, "text", "")).strip()
            start = max(prior_segment_end, milliseconds(getattr(raw_segment, "start")))
            end = milliseconds(getattr(raw_segment, "end"))
            if not text or end <= start:
                continue
            segment = {
                "startMs": start,
                "endMs": end,
                "text": text,
                "confidence": confidence_from_log_probability(
                    getattr(raw_segment, "avg_logprob", None)
                ),
            }
            segments.append(segment)
            prior_segment_end = end
            prior_word_end = start
            if job["wordTimestamps"]:
                for raw_word in getattr(raw_segment, "words", None) or ():
                    word = normalize_word(raw_word, start, end, prior_word_end)
                    if word is not None:
                        words.append(word)
                        prior_word_end = word["endMs"]
            if duration > 0:
                progress(job_id, 0.08 + 0.84 * min(1.0, end / (duration * 1000)), "decoding local audio")
    except Exception:
        error(
            request_id,
            job_id,
            "PROVIDER_OUTPUT_INVALID",
            "The local transcription provider could not decode this source",
            False,
        )
        return

    if cancelled.is_set():
        send_cancelled(job_id)
        return
    progress(job_id, 0.96, "normalizing transcript timing")
    _, provider_version = faster_whisper_state()
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "job.result",
            "jobId": job_id,
            "result": {
                "kind": "transcription",
                "language": "en",
                "segments": segments,
                "words": words if job["wordTimestamps"] else None,
                "diarization": "absent",
                "provenance": {
                    "provider": "faster-whisper",
                    "providerClass": "local",
                    "modelId": model_id,
                    "providerVersion": provider_version or "unknown",
                    "optionsVersion": "transcription-v1",
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            },
        }
    )


def send_cancelled(job_id):
    send(
        {
            "protocolVersion": PROTOCOL_VERSION,
            "type": "job.cancelled",
            "jobId": job_id,
        }
    )


def run_job(job_id, request_id, job, cancelled):
    try:
        if job.get("kind") == "transcription":
            transcribe(job_id, request_id, job, cancelled)
        else:
            error(
                request_id,
                job_id,
                "DEPENDENCY_UNAVAILABLE",
                "The requested provider capability is not installed",
                False,
            )
    finally:
        with active_lock:
            active_jobs.pop(job_id, None)


def start_job(message):
    job_id = message.get("jobId")
    job = message.get("job") or {}
    if not isinstance(job_id, str) or not job_id:
        error(message.get("requestId"), None, "PROVIDER_OUTPUT_INVALID", "Invalid job identifier", False)
        return
    with active_lock:
        if job_id in active_jobs:
            error(message.get("requestId"), job_id, "PROVIDER_OUTPUT_INVALID", "Duplicate job", False)
            return
        cancelled = threading.Event()
        active_jobs[job_id] = cancelled
    threading.Thread(
        target=run_job,
        args=(job_id, message.get("requestId"), job, cancelled),
        daemon=True,
    ).start()


def cancel_job(job_id):
    with active_lock:
        cancelled = active_jobs.get(job_id)
    if cancelled is None:
        send_cancelled(job_id)
    else:
        cancelled.set()


def main():
    global running
    threading.Thread(target=heartbeat, daemon=True).start()
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except (TypeError, ValueError):
            error(None, None, "PROVIDER_OUTPUT_INVALID", "Malformed command", False)
            continue
        request_id = message.get("requestId")
        if message.get("protocolVersion") != PROTOCOL_VERSION:
            error(request_id, message.get("jobId"), "PROVIDER_OUTPUT_INVALID", "Protocol version mismatch", False)
            continue
        message_type = message.get("type")
        if message_type == "hello":
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "ready",
                    "requestId": request_id,
                    "workerVersion": WORKER_VERSION,
                    "capabilities": capabilities(),
                    "status": status(),
                }
            )
        elif message_type == "capabilities.get":
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "capabilities",
                    "requestId": request_id,
                    "capabilities": capabilities(),
                }
            )
        elif message_type == "status.get":
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "status",
                    "requestId": request_id,
                    "status": status(),
                }
            )
        elif message_type == "job.start":
            start_job(message)
        elif message_type == "job.cancel":
            cancel_job(message.get("jobId"))
        elif message_type == "shutdown":
            with active_lock:
                for cancelled in active_jobs.values():
                    cancelled.set()
            send(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "type": "shutdown.complete",
                    "requestId": request_id,
                }
            )
            running = False
            return
        else:
            error(request_id, message.get("jobId"), "PROVIDER_OUTPUT_INVALID", "Unknown command", False)


if __name__ == "__main__":
    main()
