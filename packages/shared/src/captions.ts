import type { CaptionCue } from './schemas';

/** Sentence ends at . ! ? । ॥ followed by whitespace (so "3.5" is not split). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।॥])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Greedy packing; used only when a single word is longer than maxChars. */
function greedyChunks(words: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
    else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Splits words into exactly k contiguous groups minimising the longest group (incl. spaces).
 * Returns group end indices (exclusive) and that longest length. Words per sentence are few, so O(k·n²) is fine.
 */
function minMaxPartition(words: string[], k: number): { ends: number[]; longest: number } {
  const n = words.length;
  const prefix = [0];
  for (const w of words) prefix.push(prefix[prefix.length - 1] + w.length);
  const len = (i: number, j: number) => prefix[j] - prefix[i] + (j - i - 1); // words i..j-1 joined by spaces
  // best[g][j]: minimal longest group when splitting words 0..j-1 into g groups
  const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0][0] = 0;
  for (let g = 1; g <= k; g++) {
    for (let j = g; j <= n; j++) {
      for (let i = g - 1; i < j; i++) {
        const v = Math.max(best[g - 1][i], len(i, j));
        if (v < best[g][j]) {
          best[g][j] = v;
          cut[g][j] = i;
        }
      }
    }
  }
  const ends: number[] = [];
  for (let g = k, j = n; g > 0; j = cut[g][j], g--) ends.unshift(j);
  return { ends, longest: best[k][n] };
}

/**
 * Splits text into caption chunks: one per sentence, or — for a sentence longer than maxChars —
 * the minimum number of chunks with balanced lengths (avoids one-word "orphan" captions).
 * Splits only at whitespace, so Devanagari clusters are never broken.
 */
export function chunkCaption(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (const sentence of splitSentences(text)) {
    const words = sentence.split(/\s+/);
    if (sentence.length <= maxChars) {
      chunks.push(words.join(' '));
      continue;
    }
    if (words.some((w) => w.length > maxChars)) {
      chunks.push(...greedyChunks(words, maxChars));
      continue;
    }
    for (let k = Math.ceil(sentence.length / maxChars); k <= words.length; k++) {
      const { ends, longest } = minMaxPartition(words, k);
      if (longest <= maxChars) {
        let start = 0;
        for (const end of ends) {
          chunks.push(words.slice(start, end).join(' '));
          start = end;
        }
        break;
      }
    }
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
