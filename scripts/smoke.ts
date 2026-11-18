// End-to-end smoke test against a running stack (npm run dev).
// Usage: tsx scripts/smoke.ts en|hi|long
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobRecord, JobRequest, VideoSpec } from '@cvs/shared';
import { checkVideo, probeVideo } from '../apps/api/src/ffmpeg';
import { runProcess } from '../apps/api/src/proc';

const mode = process.argv[2] as 'en' | 'hi' | 'long';
if (!['en', 'hi', 'long'].includes(mode)) throw new Error('usage: smoke.ts en|hi|long');
const API = process.env.API_URL ?? 'http://localhost:4000';
const DATA = process.env.DATA_DIR ?? 'data';

const script = await readFile(`scripts/fixtures/${mode}.txt`, 'utf8');
const req: JobRequest = {
  script,
  lang: mode === 'hi' ? 'hi' : 'en-us',
  voice: mode === 'hi' ? 'hf_alpha' : 'af_heart',
  speed: 1,
  bgm: false,
};

const t0 = Date.now();
const created = await fetch(`${API}/api/jobs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(req),
});
if (created.status !== 202) throw new Error(`POST failed: ${created.status} ${await created.text()}`);
const { id } = (await created.json()) as { id: string };
console.log(`[${mode}] job ${id}`);

let job: JobRecord;
for (;;) {
  job = (await (await fetch(`${API}/api/jobs/${id}`)).json()) as JobRecord;
  process.stdout.write(`\r[${mode}] ${job.status} ${job.stage ?? ''} ${job.progress}%     `);
  if (job.status === 'done' || job.status === 'failed') break;
  if (Date.now() - t0 > 10 * 60_000) throw new Error('timeout after 10 min');
  await new Promise((r) => setTimeout(r, 2000));
}
console.log();

if (mode === 'long') {
  if (job.status !== 'failed' || job.error?.code !== 'DURATION_EXCEEDED') {
    throw new Error(`expected DURATION_EXCEEDED, got ${job.status} ${job.error?.code}`);
  }
  console.log(`PASS [long] rejected after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${job.error.message}`);
  process.exit(0);
}

if (job.status !== 'done') throw new Error(`job failed: ${job.error?.code} ${job.error?.message}`);
const dir = join(DATA, 'jobs', id);
const spec = JSON.parse(await readFile(join(dir, 'spec.json'), 'utf8')) as VideoSpec;
const info = await probeVideo(join(dir, 'out.mp4'));
const problems = checkVideo(info, spec.totalFrames);
const dur = info.video?.durationSec ?? 0;
if (dur < 30 || dur > 45) problems.push(`duration ${dur.toFixed(2)} s outside 30–45 s`);
const decode = await runProcess('ffmpeg', ['-v', 'error', '-i', join(dir, 'out.mp4'), '-f', 'null', '-']);
if (decode.stderr.trim()) problems.push(`decode errors: ${decode.stderr.trim().slice(0, 200)}`);
const shortCues = spec.scenes.flatMap((s) => s.captions).filter((c) => c.endFrame - c.startFrame < 15);
if (shortCues.length) problems.push(`captions shown < 0.5 s: ${shortCues.map((c) => c.text).join(' | ')}`);
if (problems.length) throw new Error(`FAIL [${mode}]:\n - ${problems.join('\n - ')}`);
console.log(
  `PASS [${mode}] ${dur.toFixed(2)} s, ${info.video!.frames} frames, ` +
    `A/V drift ${(Math.abs(info.audio!.durationSec - dur) * 1000).toFixed(0)} ms, ` +
    `total time ${((Date.now() - t0) / 1000).toFixed(0)} s → ${join(dir, 'out.mp4')}`,
);
