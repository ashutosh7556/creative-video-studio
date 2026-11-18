import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRequest } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidJobId } from '../src/ids';
import { JobStore } from '../src/jobStore';

const req: JobRequest = { script: 'Hi.', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false };
let dir: string;
let store: JobStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-store-'));
  store = new JobStore(dir);
  await store.init();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('ids', () => {
  it('accepts nanoid and rejects traversal', () => {
    expect(isValidJobId('V1StGXR8_Z5jdHi6B-myT')).toBe(true);
    expect(isValidJobId('../../etc/passwd')).toBe(false);
    expect(isValidJobId('short')).toBe(false);
  });
});

describe('JobStore', () => {
  it('creates a queued job and reads it back', async () => {
    const job = await store.create(req);
    expect(job.status).toBe('queued');
    expect(await store.get(job.id)).toEqual(job);
  });

  it('serialises concurrent updates without losing writes', async () => {
    const job = await store.create(req);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.update(job.id, (j) => ({ ...j, warnings: [...j.warnings, `w${i}`] })),
      ),
    );
    const final = await store.get(job.id);
    expect(final!.warnings).toHaveLength(25);
    expect(new Set(final!.warnings).size).toBe(25);
  });

  it('leaves no temp files behind', async () => {
    const job = await store.create(req);
    await Promise.all(Array.from({ length: 10 }, () => store.update(job.id, (j) => ({ ...j, progress: j.progress + 1 }))));
    const files = await readdir(join(dir, job.id));
    expect(files).toEqual(['job.json']);
  });

  it('treats corrupt or missing job.json as no job and excludes it from list', async () => {
    const good = await store.create(req);
    const bad = 'A'.repeat(21);
    await mkdir(join(dir, bad));
    await writeFile(join(dir, bad, 'job.json'), '{not json');
    expect(await store.get(bad)).toBeNull();
    expect(await store.get('B'.repeat(21))).toBeNull();
    expect((await store.list()).map((j) => j.id)).toEqual([good.id]);
  });

  it('returns null for invalid ids instead of touching the filesystem', async () => {
    expect(await store.get('../x')).toBeNull();
    expect(() => store.dir('../x')).toThrow(/Invalid job id/);
  });

  it('lists newest first', async () => {
    const a = await store.create(req);
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create(req);
    expect((await store.list()).map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it('update rejects for unknown job', async () => {
    await expect(store.update('C'.repeat(21), (j) => j)).rejects.toThrow(/not found/);
  });

  it('a failed update does not block later updates on the same job', async () => {
    const job = await store.create(req);
    await expect(
      store.update(job.id, () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const after = await store.update(job.id, (j) => ({ ...j, progress: 7 }));
    expect(after.progress).toBe(7);
  });
});
