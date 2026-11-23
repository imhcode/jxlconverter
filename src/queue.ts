import type { Settings, WorkerRequest, WorkerResponse } from './types';

type Job = {
  req: WorkerRequest;
  transfer: Transferable[];
  resolve: (r: WorkerResponse) => void;
};

/** Small pool of encoder workers. Each runs single-threaded WASM, so
 *  no cross-origin-isolation headers are needed (keeps GA working).
 *  A worker whose WASM aborted (e.g. out of memory) is discarded and replaced,
 *  because the Emscripten module can't be reused after an abort. */
export class EncoderPool {
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private pending = new Map<number, { worker: Worker; job: Job }>();
  private nextId = 1;

  constructor(size = Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, 4))) {
    for (let i = 0; i < size; i++) this.idle.push(this.spawn());
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => this.done(w, e.data);
    // The browser can kill a worker outright when it runs out of memory.
    w.onerror = (e) => {
      e.preventDefault();
      this.crashed(w);
    };
    return w;
  }

  encode(input: { file?: Blob; pixels?: ImageData }, settings: Settings): Promise<WorkerResponse> {
    return new Promise((resolve) => {
      const req: WorkerRequest = { id: this.nextId++, ...input, settings };
      const transfer: Transferable[] = input.pixels ? [input.pixels.data.buffer] : [];
      this.queue.push({ req, transfer, resolve });
      this.pump();
    });
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.pending.set(job.req.id, { worker, job });
      worker.postMessage(job.req, job.transfer);
    }
  }

  private done(worker: Worker, res: WorkerResponse) {
    const entry = this.pending.get(res.id);
    this.pending.delete(res.id);
    if (!res.ok && res.code !== 'decode') {
      // Encoder state is unreliable after a failure: start fresh.
      worker.terminate();
      this.idle.push(this.spawn());
    } else {
      this.idle.push(worker);
    }
    entry?.job.resolve(res);
    this.pump();
  }

  private crashed(worker: Worker) {
    worker.terminate();
    const id = [...this.pending].find(([, v]) => v.worker === worker)?.[0];
    this.idle = this.idle.filter((w) => w !== worker);
    this.idle.push(this.spawn());
    if (id !== undefined) {
      const entry = this.pending.get(id)!;
      this.pending.delete(id);
      entry.job.resolve({ id, ok: false, code: 'memory', error: 'Worker ran out of memory' });
    }
    this.pump();
  }
}
