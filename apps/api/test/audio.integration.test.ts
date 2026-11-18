import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTiming } from '@cvs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findBgm } from '../src/bgm';
import { buildMixArgs, buildNarrationArgs, probeWavSec } from '../src/ffmpeg';
import { runProcess } from '../src/proc';
import { makeSilence, makeSine, meanVolumeDb, probeStream } from './helpers/audio';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-audio-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('narration timeline', () => {
  it('measures real WAV duration from samples', async () => {
    const f = join(dir, 'probe.wav');
    await makeSine(f, 1.234);
    expect(await probeWavSec(f)).toBeCloseTo(1.234, 3);
  });

  it('concatenated narration equals totalFrames / 30 within 1 ms', async () => {
    const lengths = [1.234, 2.5, 0.777];
    const files = await Promise.all(
      lengths.map(async (s, i) => {
        const f = join(dir, `scene_${i}.wav`);
        await makeSine(f, s, 300 + i * 100);
        return f;
      }),
    );
    const secs = await Promise.all(files.map(probeWavSec));
    const timing = buildTiming(secs);
    const out = join(dir, 'narration.wav');
    await runProcess('ffmpeg', buildNarrationArgs(files, timing.sceneFrames, out));
    expect(Math.abs((await probeWavSec(out)) - timing.totalFrames / 30)).toBeLessThan(0.001);
  });

  it('resamples 24 kHz Kokoro-style input to 48 kHz before frame-aligned padding (exact sample count)', async () => {
    const src = join(dir, 'kokoro24k.wav');
    await makeSine(src, 1.234, 440, 24000); // same format Kokoro emits: 24 kHz mono PCM16
    expect(await probeStream(src)).toMatchObject({ sampleRate: 24000, channels: 1 });
    const timing = buildTiming([await probeWavSec(src)]);
    const out = join(dir, 'narration48k.wav');
    await runProcess('ffmpeg', buildNarrationArgs([src], timing.sceneFrames, out));
    const info = await probeStream(out);
    expect(info).toMatchObject({ sampleRate: 48000, channels: 1, codec: 'pcm_s16le' });
    // ceil((1.234 + 0.6) * 30) = 56 frames × 1600 samples/frame
    expect(info.samples).toBe(56 * 1600);
    expect(info.samples).toBe(timing.totalFrames * 1600);
  });

  it('multi-scene 24 kHz input: every scene boundary lands on an exact frame sample', async () => {
    const lengths = [2.013, 3.3337, 1.0001]; // awkward lengths that do not divide evenly into frames
    const files = await Promise.all(
      lengths.map(async (s, i) => {
        const f = join(dir, `k24_${i}.wav`);
        await makeSine(f, s, 500 + i * 50, 24000);
        return f;
      }),
    );
    const timing = buildTiming(await Promise.all(files.map(probeWavSec)));
    const out = join(dir, 'narration-multi.wav');
    await runProcess('ffmpeg', buildNarrationArgs(files, timing.sceneFrames, out));
    const info = await probeStream(out);
    expect(info.sampleRate).toBe(48000);
    expect(info.samples).toBe(timing.sceneFrames.reduce((a, f) => a + f * 1600, 0));
  });
});

describe('background music', () => {
  it('keeps narration at least 12 dB louder than BGM', async () => {
    const narration = join(dir, 'n.wav');
    await makeSine(narration, 6, 440, 48000);
    const bgm = join(dir, 'bgm.wav');
    await makeSine(bgm, 2, 220, 44100); // shorter than narration -> must loop
    const silent = join(dir, 'silent.wav');
    await makeSilence(silent, 6);

    const mixed = join(dir, 'mix.wav');
    await runProcess('ffmpeg', buildMixArgs(narration, bgm, 6, mixed));
    expect(await probeWavSec(mixed)).toBeCloseTo(6, 2);

    const bgmOnly = join(dir, 'bgm-only.wav');
    await runProcess('ffmpeg', buildMixArgs(silent, bgm, 6, bgmOnly));
    const diff = (await meanVolumeDb(narration)) - (await meanVolumeDb(bgmOnly));
    expect(diff).toBeGreaterThanOrEqual(12);
  });

  it('findBgm returns null for a missing or empty folder and picks the first file by name', async () => {
    expect(await findBgm(join(dir, 'nope'))).toBeNull();
    const music = join(dir, 'music');
    await mkdir(music);
    expect(await findBgm(music)).toBeNull();
    await writeFile(join(music, 'b.mp3'), '');
    await writeFile(join(music, 'a.ogg'), '');
    await writeFile(join(music, 'notes.txt'), '');
    expect(await findBgm(music)).toBe(join(music, 'a.ogg'));
  });
});
