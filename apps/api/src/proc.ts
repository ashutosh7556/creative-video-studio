import { spawn } from 'node:child_process';

export const tail = (s: string, n = 2048): string => (s.length > n ? s.slice(-n) : s);

/** Runs a command to completion. Rejects with the stderr tail on non-zero exit. */
export function runProcess(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = tail(stderr + d, 16_384)));
    child.on('error', (err) => reject(new Error(`Failed to start ${cmd}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${tail(stderr)}`));
    });
  });
}
