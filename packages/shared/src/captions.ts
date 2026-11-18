import type { CaptionCue } from './schemas';

/** Sentence ends at . ! ? । ॥ followed by whitespace (so "3.5" is not split). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।॥])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Splits text into caption chunks: per sentence, then words packed up to maxChars.
 * Splits only at whitespace, so Devanagari clusters are never broken.
 */
export function chunkCaption(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (const sentence of splitSentences(text)) {
    let current = '';
    for (const word of sentence.split(/\s+/)) {
      if (!current) current = word;
      else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
      else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

/**
 * Times chunks across the scene's audio frames proportionally to character count.
 * Cues are contiguous; the last cue extends to the scene end (covering the silent pad).
 */
export function timeCaptions(
  chunks: string[],
  startFrame: number,
  audioFrames: number,
  sceneFrames: number,
): CaptionCue[] {
  const totalChars = chunks.reduce((s, c) => s + c.length, 0);
  let acc = 0;
  return chunks.map((text, i) => {
    const start = startFrame + Math.round((audioFrames * acc) / totalChars);
    acc += text.length;
    const end =
      i === chunks.length - 1
        ? startFrame + sceneFrames
        : startFrame + Math.round((audioFrames * acc) / totalChars);
    return { text, startFrame: start, endFrame: end };
  });
}
