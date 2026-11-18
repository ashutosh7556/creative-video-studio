import { fork, type ChildProcess } from 'node:child_process';
import type { JobRecord } from '@cvs/shared';
import type { JobStore } from './jobStore';
import { tail } from './proc';
import type { WorkerMessage, WorkerStart } from './worker/messages';

export interface JobRunner {
  enqueue(id: string): void;
  activeJobId(): string | null;
  stop(): void;
}

export interface LocalForkRunnerOptions {
  workerPath: string;
  execArgv: string[];
  ttsUrl: string;
  engineUrl: string;
  musicDir: string;
}

const now = () => new Date().toISOString();

/** In-memory FIFO, concurrency 1, one forked worker process per job. The API stays the only job.json writer. */
export class LocalForkRunner implements JobRunner {
  private queue: string[] = [];
  private active: { id: string; child?: ChildProcess } | null = null;

  constructor(
    private store: JobStore,
    private opts: LocalForkRunnerOptions,
  ) {}

  enqueue(id: string): void {
    if (this.active?.id === id || this.queue.includes(id)) return;
    this.queue.push(id);
    this.pump();
  }

  activeJobId(): string | null {
    return this.active?.id ?? null;
  }

  stop(): void {
    this.queue = [];
    this.active?.child?.kill();
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const id = this.queue.shift()!;
    this.active = { id }; // claim synchronously so concurrent pumps cannot double-start
    this.start(id).catch((err) => {
      console.error(`[runner] failed to start job ${id}:`, err);
      this.release();
    });
  }

  private release(): void {
    this.active = null;
    this.pump();
  }

  private async start(id: string): Promise<void> {
    const job = await this.store.get(id);
    if (!job || job.status !== 'queued') return this.release();
    await this.store.update(id, (j) => ({ ...j, status: 'running', startedAt: now(), progress: 0 }));

    const child = fork(this.opts.workerPath, [], {
      execArgv: this.opts.execArgv,
      stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
    });
    this.active = { id, child };
    let stderr = '';
    child.stderr?.on('data', (d) => {
      process.stderr.write(d);
      stderr = tail(stderr + d);
    });

    let settled = false;
    const patch = (fn: (j: JobRecord) => JobRecord) =>
      this.store.update(id, fn).catch((err) => console.error(`[runner] job ${id} update failed:`, err));

    child.on('message', (m: WorkerMessage) => {
      switch (m.type) {
        case 'progress':
          void patch((j) => ({ ...j, stage: m.stage, progress: m.progress }));
          break;
        case 'warning':
          void patch((j) => ({ ...j, warnings: [...j.warnings, m.message] }));
          break;
        case 'done':
          settled = true;
          void patch((j) => ({ ...j, status: 'done', progress: 100, finishedAt: now(), result: m.result }));
          break;
        case 'failed':
          settled = true;
          void patch((j) => ({ ...j, status: 'failed', finishedAt: now(), error: m.error }));
          break;
      }
    });

    child.on('exit', (code, signal) => {
      const final = settled
        ? this.store.update(id, (j) => j) // wait for queued writes on this job to flush
        : this.store.update(id, (j) => ({
            ...j,
            status: 'failed',
            finishedAt: now(),
            error: {
              code: 'WORKER_CRASHED',
              message: `Worker exited with code ${code ?? signal} before finishing. ${stderr}`.trim(),
            },
          }));
      final.catch((err) => console.error(err)).finally(() => this.release());
    });

    const start: WorkerStart = {
      type: 'start',
      jobId: id,
      jobDir: this.store.dir(id),
      request: job.request,
      ttsUrl: this.opts.ttsUrl,
      engineUrl: this.opts.engineUrl,
      musicDir: this.opts.musicDir,
    };
    child.send(start);
  }
}
