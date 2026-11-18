import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidJobId } from './ids';
import type { JobStore } from './jobStore';

export const INTERRUPTED_MESSAGE =
  'Job was interrupted because the API or worker stopped. Please generate again.';

/** Run at startup before serving: fail interrupted jobs, return queued jobs (oldest first) to re-enqueue. */
export async function recoverJobs(store: JobStore): Promise<{ interrupted: string[]; queued: string[] }> {
  const jobs = await store.list();
  const interrupted: string[] = [];
  for (const j of jobs.filter((x) => x.status === 'running')) {
    await store.update(j.id, (r) => ({
      ...r,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: { code: 'INTERRUPTED', message: INTERRUPTED_MESSAGE },
    }));
    await rm(join(store.dir(j.id), 'out.tmp.mp4'), { force: true });
    interrupted.push(j.id);
  }
  const queued = jobs
    .filter((x) => x.status === 'queued')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((x) => x.id);
  return { interrupted, queued };
}

/** Deletes done/failed jobs finished more than maxAgeMs ago. Never touches active, queued, running or invalid dirs. */
export async function cleanupJobs(
  store: JobStore,
  opts: { now: number; maxAgeMs: number; activeId: string | null },
): Promise<string[]> {
  const removed: string[] = [];
  const entries = await readdir(store.jobsDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!isValidJobId(entry) || entry === opts.activeId) continue;
    const job = await store.get(entry);
    if (!job) continue; // invalid/corrupt: keep for manual inspection
    if (job.status !== 'done' && job.status !== 'failed') continue;
    if (!job.finishedAt) continue;
    if (opts.now - Date.parse(job.finishedAt) <= opts.maxAgeMs) continue;
    await rm(store.dir(entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}
