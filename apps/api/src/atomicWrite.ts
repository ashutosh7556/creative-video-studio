import { randomBytes } from 'node:crypto';
import { open, rename as fsRename, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const RETRY_DELAYS_MS = [20, 40, 80, 160, 320];
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

export interface AtomicWriteDeps {
  /** Injectable for tests; defaults to fs.promises.rename. */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * Write to a temp file, fsync, then rename over the target.
 * On Windows, rename fails with EPERM/EBUSY/EACCES while another handle has the
 * target open without delete sharing; those are retried with backoff (620 ms total).
 */
export async function writeFileAtomic(file: string, data: string, deps: AtomicWriteDeps = {}): Promise<void> {
  const rename = deps.rename ?? fsRename;
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (RETRYABLE.has(code) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      await rm(tmp, { force: true });
      throw err;
    }
  }
}
