import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVideoSpec, type VideoSpec } from '@cvs/shared';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkVideo, probeVideo } from '../src/ffmpeg';
import { runProcess } from '../src/proc';
import { renderVideo, type RenderOptions } from '../src/render';
import { makeSine } from './helpers/audio';

const engineRoot = fileURLToPath(new URL('../../../packages/scene-engine', import.meta.url));
const ENGINE_URL = 'http://localhost:4311/engine/';
let server: PreviewServer;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-render-'));
  // Own outDir: the scene-engine test project builds packages/scene-engine/dist in parallel.
  const outDir = join(dir, 'engine-dist');
  await build({ root: engineRoot, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  server = await preview({
    root: engineRoot,
    build: { outDir },
    preview: { port: 4311, strictPort: true },
    logLevel: 'warn',
  });
}, 240_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.httpServer.close(() => r()) : r()));
  await rm(dir, { recursive: true, force: true });
});

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function expectAllDead(pids: number[]) {
  for (let i = 0; i < 40 && pids.some(isAlive); i++) await new Promise((r) => setTimeout(r, 50));
  expect(pids.filter(isAlive)).toEqual([]);
}

/** Runs renderVideo and records the spawned process ids. */
async function render(spec: VideoSpec, over: Partial<RenderOptions> & { audioFile: string; outFile: string }) {
  const pids: number[] = [];
  const progress: number[] = [];
  const promise = renderVideo({
    engineUrl: ENGINE_URL,
    spec,
    onProgress: (f) => progress.push(f),
    signal: new AbortController().signal,
    onProcesses: (p) => pids.push(...Object.values(p).filter((x): x is number => typeof x === 'number')),
    ...over,
  });
  return { promise, pids, progress };
}

describe('renderVideo', () => {
  it('renders a 2 s spec into a valid, decodable MP4 and cleans up processes', async () => {
    const spec = buildVideoSpec({ texts: ['Short test scene.'], audioSecs: [1.4], lang: 'en-us' });
    expect(spec.totalFrames).toBe(60);
    const audio = join(dir, 'a.wav');
    await makeSine(audio, spec.totalFrames / 30, 440, 48000);
    const out = join(dir, 'out.mp4');
    const r = await render(spec, { audioFile: audio, outFile: out });
    await r.promise;

    const info = await probeVideo(out);
    expect(checkVideo(info, spec.totalFrames)).toEqual([]);
    expect(info.video).toMatchObject({ codec: 'h264', width: 1280, height: 720, fps: 30, frames: 60 });
    expect(info.audio?.codec).toBe('aac');
    expect(Math.abs(info.audio!.durationSec - info.video!.durationSec)).toBeLessThan(1 / 30);
    expect(r.progress.at(-1)).toBe(spec.totalFrames);
    // Full decode of every video and audio packet must produce no errors (playable file).
    const decode = await runProcess('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-']);
    expect(decode.stderr.trim()).toBe('');

    expect(r.pids.length).toBe(2); // chromium + ffmpeg
    await expectAllDead(r.pids);
  }, 180_000);

  it('aborts with INTERRUPTED when the signal fires and kills chromium and ffmpeg', async () => {
    const spec = buildVideoSpec({ texts: ['Abort me.'], audioSecs: [1.4], lang: 'en-us' });
    const audio = join(dir, 'b.wav');
    await makeSine(audio, spec.totalFrames / 30, 440, 48000);
    const ac = new AbortController();
    const r = await render(spec, {
      audioFile: audio,
      outFile: join(dir, 'abort.mp4'),
      signal: ac.signal,
      onProgress: (f) => f >= 10 && ac.abort(),
    });
    await expect(r.promise).rejects.toMatchObject({ code: 'INTERRUPTED' });
    expect(r.pids.length).toBe(2);
    await expectAllDead(r.pids);
  }, 180_000);

  it('fails with RENDER_FAILED when the engine cannot initialise, and closes chromium', async () => {
    const spec = buildVideoSpec({ texts: ['Bad template.'], audioSecs: [1], lang: 'en-us' });
    (spec.scenes[0] as { template: string }).template = 'does-not-exist';
    const r = await render(spec, { audioFile: join(dir, 'a.wav'), outFile: join(dir, 'bad.mp4') });
    await expect(r.promise).rejects.toMatchObject({ code: 'RENDER_FAILED' });
    await expect(r.promise).rejects.toThrow(/Unknown scene template/);
    expect(r.pids.length).toBe(1); // ffmpeg never started
    await expectAllDead(r.pids);
  }, 180_000);

  it('fails with ENCODE_FAILED when ffmpeg dies (missing audio) and closes chromium', async () => {
    const spec = buildVideoSpec({ texts: ['No audio file.'], audioSecs: [1], lang: 'en-us' });
    const r = await render(spec, { audioFile: join(dir, 'missing.wav'), outFile: join(dir, 'enc.mp4') });
    await expect(r.promise).rejects.toMatchObject({ code: 'ENCODE_FAILED' });
    await expectAllDead(r.pids);
  }, 180_000);
});
