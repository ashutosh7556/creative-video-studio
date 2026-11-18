import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRecord, JobRequest } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobStore } from '../src/jobStore';
import { cleanupJobs, recoverJobs } from '../src/recovery';

const req: JobRequest = { script: 'x', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false };
const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-18T12:00:00Z');
let dir: string;
let store: JobStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-rec-'));
  store = new JobStore(dir);
  await store.init();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function job(patch: Partial<JobRecord>): Promise<JobRecord> {
  const j = await store.create(req);
  return store.update(j.id, (r) => ({ ...r, ...patch }));
}

describe('recoverJobs', () => {
  it('marks running jobs INTERRUPTED, deletes partial output, returns queued oldest first', async () => {
    const running = await job({ status: 'running' });
    await writeFile(join(store.dir(running.id), 'out.tmp.mp4'), 'partial');
    const q2 = await job({ status: 'queued', createdAt: '2026-11-18T10:00:02Z' });
    const q1 = await job({ status: 'queued', createdAt: '2026-11-18T10:00:01Z' });
    const done = await job({ status: 'done' });

    const r = await recoverJobs(store);
    expect(r.interrupted).toEqual([running.id]);
    expect(r.queued).toEqual([q1.id, q2.id]);
    const after = await store.get(running.id);
    expect(after).toMatchObject({ status: 'failed', error: { code: 'INTERRUPTED' } });
    expect(after!.finishedAt).toBeDefined();
    expect(await readdir(store.dir(running.id))).not.toContain('out.tmp.mp4');
    expect((await store.get(done.id))!.status).toBe('done');
  });

  it('keeps the interrupted job directory (only the partial MP4 is removed)', async () => {
    const running = await job({ status: 'running' });
    await writeFile(join(store.dir(running.id), 'narration.wav'), 'keep');
    await recoverJobs(store);
    expect(await readdir(store.dir(running.id))).toEqual(expect.arrayContaining(['job.json', 'narration.wav']));
  });
});

describe('cleanupJobs', () => {
  it('removes only finished jobs older than 24 h and never active/queued/running/invalid dirs', async () => {
    const oldDone = await job({ status: 'done', finishedAt: new Date(NOW - 25 * HOUR).toISOString() });
    const oldFailed = await job({ status: 'failed', finishedAt: new Date(NOW - 48 * HOUR).toISOString() });
    const recentDone = await job({ status: 'done', finishedAt: new Date(NOW - 23 * HOUR).toISOString() });
    const queued = await job({ status: 'queued', createdAt: new Date(NOW - 72 * HOUR).toISOString() });
    const running = await job({ status: 'running', startedAt: new Date(NOW - 72 * HOUR).toISOString() });
    const activeOld = await job({ status: 'done', finishedAt: new Date(NOW - 30 * HOUR).toISOString() });
    const noFinish = await job({ status: 'failed' });
    const invalid = 'Z'.repeat(21);
    await mkdir(join(dir, invalid));
    await writeFile(join(dir, invalid, 'job.json'), 'garbage');
    await mkdir(join(dir, 'not-a-job-dir'));

    const removed = await cleanupJobs(store, { now: NOW, maxAgeMs: 24 * HOUR, activeId: activeOld.id });
    expect(removed.sort()).toEqual([oldDone.id, oldFailed.id].sort());
    const left = await readdir(dir);
    for (const id of [recentDone.id, queued.id, running.id, activeOld.id, noFinish.id, invalid, 'not-a-job-dir']) {
      expect(left).toContain(id);
    }
  });
});
