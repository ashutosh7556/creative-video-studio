import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobRecord, JobRequest } from '@cvs/shared';
import { writeFileAtomic } from './atomicWrite';
import { isValidJobId, newJobId } from './ids';

/** File-backed job store. The API process is the only writer of job.json. */
export class JobStore {
  private chains = new Map<string, Promise<unknown>>();

  constructor(readonly jobsDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true });
  }

  dir(id: string): string {
    if (!isValidJobId(id)) throw new Error('Invalid job id');
    return join(this.jobsDir, id);
  }

  async create(request: JobRequest): Promise<JobRecord> {
    const id = newJobId();
    await mkdir(this.dir(id), { recursive: true });
    const job: JobRecord = {
      id,
      createdAt: new Date().toISOString(),
      request,
      status: 'queued',
      progress: 0,
      warnings: [],
    };
    await this.write(job);
    return job;
  }

  async get(id: string): Promise<JobRecord | null> {
    if (!isValidJobId(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir(id), 'job.json'), 'utf8')) as JobRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[jobs] unreadable job.json for ${id}: ${(err as Error).message}`);
      }
      return null;
    }
  }

  /** Serialised read-modify-write per job. A failed update does not block later ones. */
  update(id: string, fn: (job: JobRecord) => JobRecord): Promise<JobRecord> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const current = await this.get(id);
        if (!current) throw new Error(`Job ${id} not found`);
        const updated = fn(structuredClone(current));
        await this.write(updated);
        return updated;
      });
    this.chains.set(id, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.chains.get(id) === next) this.chains.delete(id);
      });
    return next;
  }

  async list(): Promise<JobRecord[]> {
    const entries = await readdir(this.jobsDir).catch(() => [] as string[]);
    const jobs = await Promise.all(entries.filter(isValidJobId).map((id) => this.get(id)));
    return jobs
      .filter((j): j is JobRecord => j !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private write(job: JobRecord): Promise<void> {
    return writeFileAtomic(join(this.dir(job.id), 'job.json'), JSON.stringify(job, null, 2));
  }
}
