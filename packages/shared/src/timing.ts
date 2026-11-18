import { FPS, MAX_DURATION_SEC, SCENE_PAD_SEC, SPEAKING_RATES, type Lang } from './constants';
import { PipelineError } from './errors';

export interface Timing {
  sceneFrames: number[];
  startFrames: number[];
  /** Frames covered by actual speech (for caption timing). */
  audioFrames: number[];
  totalFrames: number;
  videoSec: number;
}

const EPS = 1e-6;

export function buildTiming(audioSecs: number[]): Timing {
  const sceneFrames = audioSecs.map((a) => Math.ceil((a + SCENE_PAD_SEC) * FPS - EPS));
  const audioFrames = audioSecs.map((a, i) => Math.min(sceneFrames[i], Math.round(a * FPS)));
  const startFrames: number[] = [];
  let acc = 0;
  for (const f of sceneFrames) {
    startFrames.push(acc);
    acc += f;
  }
  return { sceneFrames, startFrames, audioFrames, totalFrames: acc, videoSec: acc / FPS };
}

export function durationExceededMessage(videoSec: number, lang: Lang): string {
  const over = videoSec - MAX_DURATION_SEC;
  const words = Math.ceil(over * SPEAKING_RATES[lang]);
  return (
    `Narration produces a ${videoSec.toFixed(1)} s video; the maximum is ${MAX_DURATION_SEC} s. ` +
    `Shorten the script by about ${over.toFixed(1)} s (≈ ${words} words).`
  );
}

export function assertWithinLimit(timing: Timing, lang: Lang): void {
  if (timing.videoSec > MAX_DURATION_SEC + EPS) {
    throw new PipelineError('DURATION_EXCEEDED', durationExceededMessage(timing.videoSec, lang));
  }
}
