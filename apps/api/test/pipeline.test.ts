import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PipelineError, type JobRequest, type VoicesByLang } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMixArgs } from '../src/ffmpeg';
import { runPipeline, type PipelineDeps, type Reporter } from '../src/pipeline';
import { runProcess } from '../src/proc';
import type { RenderOptions } from '../src/render';
import type { TtsLike } from '../src/ttsClient';
import { makeSilence, makeSine, meanVolumeDb } from './helpers/audio';

let root: string;
let dir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cvs-pipe-'));
  dir = join(root, 'job');
  await mkdir(dir);
});
afterEach(() => rm(root, { recursive: true, force: true }));

/** Fake TTS producing a real 24 kHz WAV of `secPerScene` seconds. */
function fakeTts(secPerScene: number, healthy = true): TtsLike {
  return {
    baseUrl: 'http://fake',
    health: async () => healthy,
    voices: async () => ({}) as VoicesByLang,
    async synthesize(_req, sceneNo) {
      const f = join(root, `src_${sceneNo}.wav`);
      await makeSine(f, secPerScene);
      return { wav: await readFile(f), headerSec: secPerScene };
    },
  };
}

function recorder(): Reporter & { stages: string[]; warnings: string[] } {
  const r = {
    stages: [] as string[],
    warnings: [] as string[],
    progress(stage: string) {
      if (r.stages.at(-1) !== stage) r.stages.push(stage);
    },
    warning(m: string) {
      r.warnings.push(m);
    },
  };
  return r;
}

const req = (over: Partial<JobRequest> = {}): JobRequest => ({
  script: 'Scene one.\n\nScene two.',
  lang: 'en-us',
  voice: 'af_heart',
  speed: 1,
  bgm: false,
  ...over,
});

/** Deps with a fake renderer that records the audio file it was given and writes a placeholder MP4. */
function deps(tts: TtsLike, musicDir = join(root, 'no-music')) {
  const seen: { audioFile?: string } = {};
  const d: PipelineDeps = {
    tts,
    engineUrl: 'http://unused',
    musicDir,
    render: async (o: RenderOptions) => {
      seen.audioFile = o.audioFile;
      o.onProgress(o.spec.totalFrames);
      await writeFile(o.outFile, 'mp4');
    },
    verifyOutput: async () => [],
  };
  return { d, seen };
}

const run = (r: JobRequest, d: PipelineDeps, rep = recorder()) => runPipeline(dir, r, d, rep, new AbortController().signal);

describe('runPipeline', () => {
  it('fails with TTS_UNAVAILABLE when the service is down', async () => {
    await expect(run(req(), deps(fakeTts(1, false)).d)).rejects.toMatchObject({ code: 'TTS_UNAVAILABLE' });
  });

  it('fails with DURATION_EXCEEDED before mixing or rendering', async () => {
    let rendered = false;
    const { d } = deps(fakeTts(23));
    d.render = async () => void (rendered = true);
    await expect(run(req(), d)).rejects.toMatchObject({ code: 'DURATION_EXCEEDED' });
    expect(rendered).toBe(false);
    expect(await readdir(dir)).not.toContain('narration.wav');
  });

  it('runs all stages, writes spec.json and out.mp4, warns on short video', async () => {
    const r = recorder();
    const { d, seen } = deps(fakeTts(1.2));
    const result = await run(req(), d, r);
    expect(r.stages).toEqual(['tts', 'audio', 'render']);
    expect(result.sceneCount).toBe(2);
    expect(result.durationSec).toBeCloseTo((2 * 54) / 30, 6); // ceil(1.8*30)=54 frames per scene
    expect(r.warnings.some((w) => w.includes('shorter than the 30–45 s target'))).toBe(true);
    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(['scene_0.wav', 'scene_1.wav', 'narration.wav', 'spec.json', 'out.mp4']));
    expect(files).not.toContain('out.tmp.mp4');
    expect(basename(seen.audioFile!)).toBe('narration.wav');
    const spec = JSON.parse(await readFile(join(dir, 'spec.json'), 'utf8'));
    expect(spec.totalFrames).toBe(108);
  });

  describe('background music', () => {
    async function musicDirWithTrack() {
      const music = join(root, 'music');
      await mkdir(music);
      await makeSine(join(music, 'track.wav'), 2, 220, 44100);
      return music;
    }

    it('BGM enabled + file present: renders with mix.wav, narration clearly louder', async () => {
      const r = recorder();
      const { d, seen } = deps(fakeTts(1.2), await musicDirWithTrack());
      await run(req({ bgm: true }), d, r);
      expect(basename(seen.audioFile!)).toBe('mix.wav');
      expect(r.warnings.some((w) => w.includes('assets/music'))).toBe(false);
      // Same BGM mixed under silence = BGM level alone; narration must be >= 12 dB above it.
      const silent = join(root, 'silent.wav');
      await makeSilence(silent, 3.6);
      const bgmOnly = join(root, 'bgm-only.wav');
      await runProcess('ffmpeg', buildMixArgs(silent, join(root, 'music', 'track.wav'), 3.6, bgmOnly));
      const narrationDb = await meanVolumeDb(join(dir, 'narration.wav'));
      expect(narrationDb - (await meanVolumeDb(bgmOnly))).toBeGreaterThanOrEqual(12);
    });

    it('BGM disabled + file present: music is ignored', async () => {
      const { d, seen } = deps(fakeTts(1.2), await musicDirWithTrack());
      await run(req({ bgm: false }), d);
      expect(basename(seen.audioFile!)).toBe('narration.wav');
      expect(await readdir(dir)).not.toContain('mix.wav');
    });

    it('BGM enabled + no file: renders narration only and warns', async () => {
      const r = recorder();
      const { d, seen } = deps(fakeTts(1.2));
      await run(req({ bgm: true }), d, r);
      expect(basename(seen.audioFile!)).toBe('narration.wav');
      expect(r.warnings).toContain(
        'Background music was enabled but no file was found in assets/music; the video was rendered without music.',
      );
    });
  });

  it('removes out.tmp.mp4 and rethrows when rendering fails', async () => {
    const { d } = deps(fakeTts(1.2));
    d.render = async (o) => {
      await writeFile(o.outFile, 'partial');
      throw new PipelineError('RENDER_FAILED', 'boom');
    };
    await expect(run(req(), d)).rejects.toMatchObject({ code: 'RENDER_FAILED', message: 'boom' });
    const files = await readdir(dir);
    expect(files).not.toContain('out.tmp.mp4');
    expect(files).not.toContain('out.mp4');
  });

  it('removes out.tmp.mp4 when the output check fails', async () => {
    const { d } = deps(fakeTts(1.2));
    d.verifyOutput = async () => ['frames 1 != 108'];
    await expect(run(req(), d)).rejects.toMatchObject({ code: 'ENCODE_FAILED' });
    expect(await readdir(dir)).not.toContain('out.tmp.mp4');
  });
});
