import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JobRecord, JobRequest } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobStore } from '../src/jobStore';
import { LocalForkRunner } from '../src/runner';

const workerPath = fileURLToPath(new URL('./fixtures/fakeWorker.mjs', import.meta.url));
const req = (script: string): JobRequest => ({ script, lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false });

let dir: string;
let store: JobStore;
let runner: LocalForkRunner;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-runner-'));
  store = new JobStore(dir);
  await store.init();
  runner = new LocalForkRunner(store, { workerPath, execArgv: [], ttsUrl: 'x', engineUrl: 'x', musicDir: 'x' });
});
afterEach(async () => {
  runner.stop();
  await rm(dir, { recursive: true, force: true });
});

async function waitFinished(id: string): Promise<JobRecord> {
  for (let i = 0; i < 200; i++) {
    const j = await store.get(id);
    if (j && (j.status === 'done' || j.status === 'failed') && runner.activeJobId() !== id) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timeout');
}

describe('LocalForkRunner', () => {
  it('marks a job done with result, progress 100 and warnings', async () => {
    const job = await store.create(req('ok'));
    runner.enqueue(job.id);
    const j = await waitFinished(job.id);
    expect(j).toMatchObject({ status: 'done', progress: 100, warnings: ['w1'], result: { durationSec: 33, sceneCount: 3 } });
    expect(j.startedAt).toBeDefined();
    expect(j.finishedAt).toBeDefined();
  });

  it('records worker-reported failures', async () => {
    const job = await store.create(req('fail'));
    runner.enqueue(job.id);
    expect(await waitFinished(job.id)).toMatchObject({ status: 'failed', error: { code: 'TTS_FAILED', message: 'Scene 1: boom' } });
  });

  it('marks WORKER_CRASHED when the worker exits without reporting', async () => {
    const job = await store.create(req('crash'));
    runner.enqueue(job.id);
    const j = await waitFinished(job.id);
    expect(j.status).toBe('failed');
    expect(j.error?.code).toBe('WORKER_CRASHED');
    expect(j.error?.message).toMatch(/code 3/);
  });

  it('continues with the next job after a crash', async () => {
    const a = await store.create(req('crash'));
    const b = await store.create(req('ok'));
    runner.enqueue(a.id);
    runner.enqueue(b.id);
    expect((await waitFinished(a.id)).error?.code).toBe('WORKER_CRASHED');
    expect((await waitFinished(b.id)).status).toBe('done');
  });

  it('runs jobs one at a time in FIFO order', async () => {
    const a = await store.create(req('slow'));
    const b = await store.create(req('ok'));
    runner.enqueue(a.id);
    runner.enqueue(b.id);
    expect(runner.activeJobId()).toBe(a.id);
    const ja = await waitFinished(a.id);
    const jb = await waitFinished(b.id);
    expect(Date.parse(jb.startedAt!)).toBeGreaterThanOrEqual(Date.parse(ja.finishedAt!));
  });

  it('never has two jobs running at once (concurrency 1)', async () => {
    const jobs = await Promise.all([1, 2, 3].map(() => store.create(req('slow'))));
    for (const j of jobs) runner.enqueue(j.id);
    let maxRunning = 0;
    const poll = setInterval(async () => {
      const running = (await store.list()).filter((j) => j.status === 'running').length;
      maxRunning = Math.max(maxRunning, running);
    }, 20);
    for (const j of jobs) await waitFinished(j.id);
    clearInterval(poll);
    expect(maxRunning).toBe(1);
  });

  it('ignores duplicate enqueues and non-queued jobs', async () => {
    const job = await store.create(req('ok'));
    await store.update(job.id, (j) => ({ ...j, status: 'done' }));
    runner.enqueue(job.id);
    runner.enqueue(job.id);
    await new Promise((r) => setTimeout(r, 100));
    expect(runner.activeJobId()).toBeNull();
  });
});
