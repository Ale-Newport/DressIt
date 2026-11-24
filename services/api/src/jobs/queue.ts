/**
 * Background jobs. Production: BullMQ on Redis (retries with backoff, separate
 * worker process: `pnpm dev:worker`). Development/tests: an in-process queue with
 * the same semantics so the API works without a separate worker.
 */
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

export interface ImageAnalysisJob {
  importJobId: string;
  userId: string;
}

export interface AttemptInfo {
  attempt: number;
  isLastAttempt: boolean;
}

export type JobProcessor = (job: ImageAnalysisJob, attempt: AttemptInfo) => Promise<void>;

/** Image generation (studio photo, avatar render): slow and GPU-bound, its own queue. */
export interface GenerationJob {
  generationId: string;
  userId: string;
}
export type GenerationProcessor = (job: GenerationJob, attempt: AttemptInfo) => Promise<void>;
const GENERATION_QUEUE = 'image-generation';
const GENERATION_ATTEMPTS = 2;

const MAX_ATTEMPTS = 5;

export interface JobQueue {
  enqueueImageAnalysis(job: ImageAnalysisJob): Promise<void>;
  startWorker(processor: JobProcessor): Promise<void>;
  enqueueGeneration(job: GenerationJob): Promise<void>;
  startGenerationWorker(processor: GenerationProcessor): Promise<void>;
  close(): Promise<void>;
  readonly mode: 'bullmq' | 'inline';
}

const QUEUE = 'image-analysis';

export class BullJobQueue implements JobQueue {
  readonly mode = 'bullmq' as const;
  private readonly queue: Queue;
  private worker: Worker | null = null;
  private generationQueue: Queue | null = null;
  private generationWorker: Worker | null = null;
  private readonly connection: ConnectionOptions;
  constructor(redisUrl: string) {
    const u = new URL(redisUrl);
    this.connection = { host: u.hostname, port: Number(u.port || 6379), ...(u.password ? { password: decodeURIComponent(u.password) } : {}), maxRetriesPerRequest: null };
    this.queue = new Queue(QUEUE, { connection: this.connection });
  }
  async enqueueImageAnalysis(job: ImageAnalysisJob) {
    await this.queue.add('analyze', job, {
      jobId: job.importJobId,
      attempts: MAX_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
  async startWorker(processor: JobProcessor) {
    this.worker = new Worker(
      QUEUE,
      async (j) => processor(j.data as ImageAnalysisJob, { attempt: j.attemptsMade + 1, isLastAttempt: j.attemptsMade + 1 >= (j.opts.attempts ?? MAX_ATTEMPTS) }),
      { connection: this.connection, concurrency: 2 },
    );
  }
  private genQueue(): Queue {
    this.generationQueue ??= new Queue(GENERATION_QUEUE, { connection: this.connection });
    return this.generationQueue;
  }
  async enqueueGeneration(job: GenerationJob) {
    await this.genQueue().add('generate', job, {
      jobId: job.generationId,
      attempts: GENERATION_ATTEMPTS,
      backoff: { type: 'fixed', delay: 15_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }
  async startGenerationWorker(processor: GenerationProcessor) {
    // One at a time: a single GPU (or Apple Silicon) renders one image at once.
    this.generationWorker = new Worker(
      GENERATION_QUEUE,
      async (j) => processor(j.data as GenerationJob, { attempt: j.attemptsMade + 1, isLastAttempt: j.attemptsMade + 1 >= (j.opts.attempts ?? GENERATION_ATTEMPTS) }),
      { connection: this.connection, concurrency: 1, lockDuration: 10 * 60_000 },
    );
  }
  async close() {
    await this.worker?.close();
    await this.generationWorker?.close();
    await this.queue.close();
    await this.generationQueue?.close();
  }
}

/** In-process queue with retries; used in tests and single-process development. */
export class InlineJobQueue implements JobQueue {
  readonly mode = 'inline' as const;
  private processor: JobProcessor | null = null;
  private generationProcessor: GenerationProcessor | null = null;
  /** Generation runs one job at a time, like the real worker. */
  private generationChain: Promise<void> = Promise.resolve();
  private readonly pending = new Set<Promise<void>>();
  private readonly retries: number;
  constructor(retries = 2) {
    this.retries = retries;
  }
  async enqueueImageAnalysis(job: ImageAnalysisJob) {
    const run = async () => {
      for (let attempt = 0; attempt <= this.retries; attempt++) {
        try {
          if (!this.processor) return;
          await this.processor(job, { attempt: attempt + 1, isLastAttempt: attempt >= this.retries });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
        }
      }
    };
    const p = run().finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
  async startWorker(processor: JobProcessor) {
    this.processor = processor;
  }
  async enqueueGeneration(job: GenerationJob) {
    const run = async () => {
      for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt++) {
        try {
          if (!this.generationProcessor) return;
          await this.generationProcessor(job, { attempt: attempt + 1, isLastAttempt: attempt + 1 >= GENERATION_ATTEMPTS });
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    };
    const p = (this.generationChain = this.generationChain.then(run, run)).finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
  async startGenerationWorker(processor: GenerationProcessor) {
    this.generationProcessor = processor;
  }
  /** Test helper: wait for all in-flight jobs. */
  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }
  async close() {
    await this.drain();
  }
}
