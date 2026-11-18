import { rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FPS,
  MIN_TARGET_SEC,
  PipelineError,
  assertWithinLimit,
  buildTiming,
  buildVideoSpec,
  errorMessage,
  splitScenes,
  type JobRequest,
  type JobStage,
} from '@cvs/shared';
import { BGM_MISSING_WARNING, findBgm } from './bgm';
import { buildMixArgs, buildNarrationArgs, checkVideo, probeVideo, probeWavSec } from './ffmpeg';
import { runProcess } from './proc';
import { renderVideo, type RenderOptions } from './render';
import type { TtsLike } from './ttsClient';

export interface Reporter {
  progress(stage: JobStage, progress: number): void;
  warning(message: string): void;
}

export interface PipelineDeps {
  tts: TtsLike;
  engineUrl: string;
  musicDir: string;
  render?: (o: RenderOptions) => Promise<void>;
  verifyOutput?: (file: string, expectedFrames: number) => Promise<string[]>;
}

export interface PipelineResult {
  durationSec: number;
  sceneCount: number;
}

const defaultVerify = async (file: string, frames: number) => checkVideo(await probeVideo(file), frames);

async function ffmpeg(args: string[], what: string): Promise<void> {
  try {
    await runProcess('ffmpeg', args);
  } catch (err) {
    throw new PipelineError('ENCODE_FAILED', `${what} failed: ${errorMessage(err)}`);
  }
}

/** Runs one job inside the worker process: TTS → duration check → narration/BGM → render → verify. */
export async function runPipeline(
  jobDir: string,
  req: JobRequest,
  deps: PipelineDeps,
  report: Reporter,
  signal: AbortSignal,
): Promise<PipelineResult> {
  const checkAbort = () => {
    if (signal.aborted) throw new PipelineError('INTERRUPTED', 'Job aborted');
  };
  const texts = splitScenes(req.script);

  if (!(await deps.tts.health())) {
    throw new PipelineError(
      'TTS_UNAVAILABLE',
      `TTS service not reachable at ${deps.tts.baseUrl}. Start it with \`npm run dev:tts\`.`,
    );
  }

  // 1. TTS (0–25 %)
  report.progress('tts', 0);
  const wavs: string[] = [];
  const audioSecs: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    checkAbort();
    const { wav, headerSec } = await deps.tts.synthesize(
      { text: texts[i], lang: req.lang, voice: req.voice, speed: req.speed },
      i + 1,
    );
    const file = join(jobDir, `scene_${i}.wav`);
    await writeFile(file, wav);
    const sec = await probeWavSec(file);
    if (Number.isFinite(headerSec) && Math.abs(sec - headerSec) > 0.05) {
      console.warn(`[pipeline] scene ${i + 1}: X-Duration ${headerSec}s vs measured ${sec.toFixed(4)}s`);
    }
    wavs.push(file);
    audioSecs.push(sec);
    report.progress('tts', (25 * (i + 1)) / texts.length);
  }

  // 2. Authoritative duration check, before any mixing/rendering.
  assertWithinLimit(buildTiming(audioSecs), req.lang);
  const spec = buildVideoSpec({ texts, audioSecs, lang: req.lang });
  const videoSec = spec.totalFrames / FPS;
  await writeFile(join(jobDir, 'spec.json'), JSON.stringify(spec, null, 2));

  // 3. Audio (25–30 %)
  checkAbort();
  report.progress('audio', 25);
  const narration = join(jobDir, 'narration.wav');
  await ffmpeg(buildNarrationArgs(wavs, spec.scenes.map((s) => s.frameCount), narration), 'Narration build');
  const narrationSec = await probeWavSec(narration);
  if (Math.abs(narrationSec - videoSec) > 0.001) {
    throw new PipelineError('ENCODE_FAILED', `Narration is ${narrationSec}s but video is ${videoSec}s`);
  }
  let audio = narration;
  if (req.bgm) {
    const bgm = await findBgm(deps.musicDir);
    if (!bgm) report.warning(BGM_MISSING_WARNING);
    else {
      audio = join(jobDir, 'mix.wav');
      await ffmpeg(buildMixArgs(narration, bgm, videoSec, audio), 'Background music mix');
    }
  }
  report.progress('audio', 30);

  // 4. Render + encode (30–100 %). A failed render never leaves a partial MP4 behind.
  checkAbort();
  const tmp = join(jobDir, 'out.tmp.mp4');
  try {
    await (deps.render ?? renderVideo)({
      engineUrl: deps.engineUrl,
      spec,
      audioFile: audio,
      outFile: tmp,
      signal,
      onProgress: (f) => report.progress('render', 30 + (70 * f) / spec.totalFrames),
    });
    const problems = await (deps.verifyOutput ?? defaultVerify)(tmp, spec.totalFrames);
    if (problems.length) throw new PipelineError('ENCODE_FAILED', `Output check failed: ${problems.join('; ')}`);
    await rename(tmp, join(jobDir, 'out.mp4'));
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }

  if (videoSec < MIN_TARGET_SEC) {
    report.warning(`Video is ${videoSec.toFixed(1)} s, shorter than the 30–45 s target.`);
  }
  return { durationSec: videoSec, sceneCount: texts.length };
}
