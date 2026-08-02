import type { JobDispatcher, TransactionalOutbox } from "@siftcut/infrastructure";

export class OutboxPublisher {
  private stopping = false;
  private running?: Promise<void>;
  constructor(
    private readonly outbox: TransactionalOutbox,
    private readonly dispatcher: JobDispatcher,
    private readonly options: { batchSize?: number; idleMs?: number; now?: () => Date } = {}
  ) {}
  start(): void {
    if (!this.running) this.running = this.loop();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    await this.running;
  }
  async publishOnce(): Promise<number> {
    if (this.stopping) return 0;
    const leased = await this.outbox.claim(this.options.batchSize ?? 25);
    await Promise.all(leased.map(async (record) => {
      try {
        await this.dispatcher.enqueue(record.envelope);
        await this.outbox.markDelivered(record.outboxId, record.claimToken);
      } catch {
        const delay = Math.min(300_000, 1000 * 2 ** Math.min(record.attempt - 1, 8));
        const now = this.options.now?.() ?? new Date();
        await this.outbox.markFailed(
          record.outboxId, record.claimToken, new Date(now.getTime() + delay)
        );
      }
    }));
    return leased.length;
  }
  private async loop(): Promise<void> {
    while (!this.stopping) {
      const count = await this.publishOnce();
      if (!count && !this.stopping) await delay(this.options.idleMs ?? 1_000);
    }
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
