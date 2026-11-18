import { describe, expect, it } from 'vitest';
import { countWords, estimateDurationSec } from '../src';

describe('countWords', () => {
  it('counts whitespace-separated tokens incl. Devanagari', () => {
    expect(countWords('नमस्ते  दोस्तों। आज')).toBe(3);
    expect(countWords('  ')).toBe(0);
  });
});

describe('estimateDurationSec', () => {
  it('uses language rate, speed and 0.6 s pad per scene', () => {
    // 28 words at 2.8 w/s = 10 s, + 0.6 pad
    const scene = Array(28).fill('word').join(' ');
    expect(estimateDurationSec([scene], 'en-us', 1)).toBeCloseTo(10.6, 5);
    // speed 0.5 doubles speech time
    expect(estimateDurationSec([scene], 'en-us', 0.5)).toBeCloseTo(20.6, 5);
  });
  it('uses the Hindi rate', () => {
    const scene = Array(24).fill('शब्द').join(' ');
    expect(estimateDurationSec([scene, scene], 'hi', 1)).toBeCloseTo(21.2, 5);
  });
  it('is 0 for no scenes', () => {
    expect(estimateDurationSec([], 'hi', 1)).toBe(0);
  });
});
