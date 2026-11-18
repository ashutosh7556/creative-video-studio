import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../src/atomicWrite';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-atomic-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const errno = (code: string) => Object.assign(new Error(code), { code });

describe('writeFileAtomic (injected rename)', () => {
  it('retries EPERM/EBUSY and succeeds', async () => {
    const file = join(dir, 'job.json');
    let calls = 0;
    await writeFileAtomic(file, '{"v":1}', {
      rename: async (a, b) => {
        calls++;
        if (calls === 1) throw errno('EPERM');
        if (calls === 2) throw errno('EBUSY');
        return rename(a, b);
      },
    });
    expect(calls).toBe(3);
    expect(await readFile(file, 'utf8')).toBe('{"v":1}');
    expect(await readdir(dir)).toEqual(['job.json']);
  });

  it('gives up after 5 retries, rethrows and removes the temp file', async () => {
    const file = join(dir, 'job.json');
    await writeFile(file, 'old');
    let calls = 0;
    const err = await writeFileAtomic(file, 'new', {
      rename: async () => {
        calls++;
        throw errno('EPERM');
      },
    }).catch((e) => e);
    expect(err.code).toBe('EPERM');
    expect(calls).toBe(6); // 1 attempt + 5 retries
    expect(await readFile(file, 'utf8')).toBe('old'); // previous content intact
    expect(await readdir(dir)).toEqual(['job.json']);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    const err = await writeFileAtomic(join(dir, 'job.json'), 'x', {
      rename: async () => {
        calls++;
        throw errno('ENOSPC');
      },
    }).catch((e) => e);
    expect(err.code).toBe('ENOSPC');
    expect(calls).toBe(1);
    expect(await readdir(dir)).toEqual([]);
  });
});

/** Opens `file` from a separate process with FileShare.None (blocks rename-over on Windows). */
function lockFileFor(file: string, ms: number): Promise<{ released: Promise<void> }> {
  const escaped = file.split("'").join("''");
  const script =
    `$f=[IO.File]::Open('${escaped}','Open','ReadWrite','None'); ` +
    `Write-Output LOCKED; Start-Sleep -Milliseconds ${ms}; $f.Close()`;
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
    const released = new Promise<void>((r) => ps.on('close', () => r()));
    ps.stdout.on('data', (d) => {
      if (String(d).includes('LOCKED')) resolve({ released });
    });
    ps.on('error', reject);
  });
}

describe.runIf(process.platform === 'win32')('writeFileAtomic (real Windows file lock)', () => {
  it('waits out a short exclusive lock held by another process', async () => {
    const file = join(dir, 'job.json');
    await writeFile(file, 'old');
    const lock = await lockFileFor(file, 250);
    await writeFileAtomic(file, 'new');
    await lock.released;
    expect(await readFile(file, 'utf8')).toBe('new');
    expect(await readdir(dir)).toEqual(['job.json']);
  });

  it('fails cleanly when the lock outlasts the retry budget', async () => {
    const file = join(dir, 'job.json');
    await writeFile(file, 'old');
    const lock = await lockFileFor(file, 2500);
    const err = await writeFileAtomic(file, 'new').catch((e) => e);
    await lock.released;
    expect(['EPERM', 'EBUSY', 'EACCES']).toContain(err.code);
    expect(await readFile(file, 'utf8')).toBe('old');
    expect(await readdir(dir)).toEqual(['job.json']);
  });
});
