import { existsSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { runProcess } from './proc';

/** Returns human-readable problems; empty = ready. */
export async function checkPrereqs(engineDist: string): Promise<string[]> {
  const problems: string[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) problems.push(`Node ${process.versions.node} found; Node 20 or newer is required.`);
  for (const bin of ['ffmpeg', 'ffprobe']) {
    try {
      await runProcess(bin, ['-version']);
    } catch {
      problems.push(`${bin} not found on PATH. Install FFmpeg and make sure \`${bin} -version\` works.`);
    }
  }
  if (!existsSync(join(engineDist, 'index.html'))) {
    problems.push('Scene engine is not built. Run: npm run build:engine');
  }
  try {
    // Puppeteer 25+: executablePath() returns a Promise.
    if (!existsSync(await puppeteer.executablePath())) throw new Error();
  } catch {
    problems.push('Puppeteer Chromium is missing. Run: npx puppeteer browsers install chrome');
  }
  return problems;
}
