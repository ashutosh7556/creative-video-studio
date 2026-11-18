import { describe, expect, it } from 'vitest';
import { chunkCaption, splitSentences, timeCaptions } from '../src';

describe('splitSentences', () => {
  it('splits on . ! ? and keeps the delimiter', () => {
    expect(splitSentences('Hi there. How are you? Great!')).toEqual(['Hi there.', 'How are you?', 'Great!']);
  });
  it('splits on Devanagari danda and double danda', () => {
    expect(splitSentences('नमस्ते दोस्तों। आज हम सीखेंगे॥ अंत')).toEqual(['नमस्ते दोस्तों।', 'आज हम सीखेंगे॥', 'अंत']);
  });
  it('does not split decimals like 3.5', () => {
    expect(splitSentences('It is 3.5 million km. Wow.')).toEqual(['It is 3.5 million km.', 'Wow.']);
  });
});

describe('chunkCaption', () => {
  it('keeps short sentences as single chunks', () => {
    expect(chunkCaption('One. Two.', 70)).toEqual(['One.', 'Two.']);
  });
  it('packs words up to maxChars without exceeding it', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
    const chunks = chunkCaption(text, 20);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(20);
    expect(chunks.join(' ')).toBe(text);
  });
  it('never splits inside a word, even if the word exceeds maxChars', () => {
    expect(chunkCaption('supercalifragilistic ok', 10)).toEqual(['supercalifragilistic', 'ok']);
  });
  it('never breaks Devanagari words (conjuncts/matras stay intact)', () => {
    const text = 'क्षत्रिय ज्ञान विज्ञान प्रौद्योगिकी श्रद्धा द्वारा स्वतंत्रता संग्राम';
    const chunks = chunkCaption(text, 20);
    const words = new Set(text.split(' '));
    for (const c of chunks) for (const w of c.split(' ')) expect(words.has(w)).toBe(true);
    expect(chunks.join(' ')).toBe(text);
  });
});

describe('chunkCaption balancing (no orphan words)', () => {
  it('splits an over-long sentence into balanced chunks instead of leaving a tail word', () => {
    // Greedy would give 'aaaa bbbb cccc dddd' + 'eeee'.
    const chunks = chunkCaption('aaaa bbbb cccc dddd eeee', 20);
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(14);
    expect(chunks.join(' ')).toBe('aaaa bbbb cccc dddd eeee');
  });

  it('fixes the real Hindi case seen in the Phase 5 video (no lone "है।")', () => {
    const s = 'रात का आसमान हज़ारों सालों से इंसानों को आकर्षित करता रहा है।';
    const chunks = chunkCaption(s, 60);
    expect(chunks.length).toBe(2);
    expect(chunks).not.toContain('है।');
    const [a, b] = chunks.map((c) => c.length);
    expect(Math.min(a, b) / Math.max(a, b)).toBeGreaterThan(0.6);
    expect(chunks.join(' ')).toBe(s);
  });

  it('uses the minimum number of chunks and keeps each within maxChars', () => {
    const words = Array.from({ length: 30 }, (_, i) => `w${i}xx`); // 30 words × 5 chars + spaces = 179
    const chunks = chunkCaption(words.join(' '), 70);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(70);
    const lens = chunks.map((c) => c.length);
    expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(6);
  });

  it('still never splits a word longer than maxChars', () => {
    expect(chunkCaption('tiny supercalifragilisticexpialidocious end', 10)).toEqual([
      'tiny',
      'supercalifragilisticexpialidocious',
      'end',
    ]);
  });
});

describe('timeCaptions', () => {
  it('is contiguous, starts at scene start and ends at scene end', () => {
    const cues = timeCaptions(['aaaa', 'bb', 'cccc'], 100, 60, 78);
    expect(cues[0].startFrame).toBe(100);
    for (let i = 1; i < cues.length; i++) expect(cues[i].startFrame).toBe(cues[i - 1].endFrame);
    expect(cues.at(-1)!.endFrame).toBe(178);
  });
  it('distributes audio frames proportionally to character count', () => {
    const cues = timeCaptions(['aaaa', 'bb', 'cccc'], 0, 100, 120);
    expect(cues[0].endFrame).toBe(40); // 4/10 of 100
    expect(cues[1].endFrame).toBe(60); // 6/10 of 100
    expect(cues[2].endFrame).toBe(120); // last chunk extends to scene end (covers pad)
  });
  it('returns [] for no chunks', () => {
    expect(timeCaptions([], 0, 10, 10)).toEqual([]);
  });
});
