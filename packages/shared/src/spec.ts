import { CAMERA_MOVES, CAPTION_MAX_CHARS, FPS, HEIGHT, WIDTH, type Lang } from './constants';
import { chunkCaption, timeCaptions } from './captions';
import type { VideoSpec } from './schemas';
import { buildTiming } from './timing';

export interface BuildSpecInput {
  texts: string[];
  audioSecs: number[];
  lang: Lang;
  seedBase?: number;
}

export function buildVideoSpec({ texts, audioSecs, lang, seedBase = 1 }: BuildSpecInput): VideoSpec {
  if (texts.length !== audioSecs.length) {
    throw new Error(`texts (${texts.length}) and audioSecs (${audioSecs.length}) length mismatch`);
  }
  const t = buildTiming(audioSecs);
  return {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    totalFrames: t.totalFrames,
    lang,
    fontFamily: lang === 'hi' ? '"Noto Sans Devanagari", "Inter"' : '"Inter"',
    scenes: texts.map((text, i) => ({
      index: i,
      text,
      startFrame: t.startFrames[i],
      frameCount: t.sceneFrames[i],
      template: 'titleCard' as const,
      cameraMove: CAMERA_MOVES[i % CAMERA_MOVES.length],
      seed: seedBase * 1000 + i + 1,
      captions: timeCaptions(
        chunkCaption(text, CAPTION_MAX_CHARS[lang]),
        t.startFrames[i],
        t.audioFrames[i],
        t.sceneFrames[i],
      ),
    })),
  };
}
