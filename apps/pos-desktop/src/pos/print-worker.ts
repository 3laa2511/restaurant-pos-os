import type { PrintJob } from './print-job.js';
import type { PrintRepository } from './print-repository.js';
import { createSqlitePrintRepository } from './print-repository.js';
import type { LocalDatabaseBridge, TauriInvoke } from './tauri-bridge.js';

export interface PrintTransport {
  print(job: PrintJob): Promise<void>;
}

export function createTauriPrintTransport(invoke: TauriInvoke): PrintTransport {
  return {
    print: (job) => invoke.invoke('print_job', {
      payload: job.payload,
      copies: job.copies,
      station: job.station,
      orderNumber: job.orderNumber,
    }),
  };
}

export interface PrintWorkerOptions {
  repository: PrintRepository;
  transport: PrintTransport;
  workerId?: string;
  batchSize?: number;
  maxAttempts?: number;
  leaseMs?: number;
}

export interface PrintWorkerResult {
  attempted: number;
  printed: number;
  failed: number;
}

function createWorkerId(): string {
  return `print-worker:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

export class PrintWorker {
  private readonly repository: PrintRepository;
  private readonly transport: PrintTransport;
  private readonly workerId: string;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private running = false;

  constructor(options: PrintWorkerOptions) {
    this.repository = options.repository;
    this.transport = options.transport;
    this.workerId = options.workerId ?? createWorkerId();
    this.batchSize = Math.max(1, options.batchSize ?? 10);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.leaseMs = Math.max(1000, options.leaseMs ?? 30_000);
  }

  async runOnce(): Promise<PrintWorkerResult> {
    if (this.running) return { attempted: 0, printed: 0, failed: 0 };
    this.running = true;

    try {
      const jobs = await this.repository.claimPending(
        this.batchSize,
        this.maxAttempts,
        this.workerId,
        this.leaseMs,
      );

      let printed = 0;
      let failed = 0;
      for (const job of jobs) {
        try {
          await this.transport.print(job);
          await this.repository.markPrinted(job.id, this.workerId);
          printed += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          try {
            await this.repository.markFailed(job.id, this.workerId, message);
            failed += 1;
          } catch {
            // Ownership may have expired while the printer was busy. Recovery is left to the next claim.
          }
        }
      }

      return { attempted: jobs.length, printed, failed };
    } finally {
      this.running = false;
    }
  }
}

export interface PrintWorkerRuntime {
  stop(): void;
}

export interface PrintWorkerRuntimeOptions {
  db: LocalDatabaseBridge;
  invoke: TauriInvoke;
  intervalMs?: number;
  workerId?: string;
}

export function createPrintWorkerRuntime(options: PrintWorkerRuntimeOptions): PrintWorkerRuntime {
  const worker = new PrintWorker({
    repository: createSqlitePrintRepository(options.db),
    transport: createTauriPrintTransport(options.invoke),
    workerId: options.workerId,
  });

  const tick = () => {
    void worker.runOnce().catch(() => {
      // Background worker failures must never bubble into the cashier UI.
    });
  };

  tick();
  const timer = globalThis.setInterval(tick, Math.max(250, options.intervalMs ?? 1000));

  return { stop: () => globalThis.clearInterval(timer) };
}
