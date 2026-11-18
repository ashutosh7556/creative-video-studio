import { SCENE_PAD_SEC, SPEAKING_RATES, type Lang } from './constants';

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Rough pre-TTS estimate of final video length. The worker's post-TTS check is authoritative. */
export function estimateDurationSec(scenes: string[], lang: Lang, speed: number): number {
  const rate = SPEAKING_RATES[lang] * speed;
  return scenes.reduce((sum, text) => sum + countWords(text) / rate + SCENE_PAD_SEC, 0);
}
