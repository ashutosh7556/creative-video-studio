import { describe, expect, it } from 'vitest';
import { PipelineError, assertWithinLimit, buildTiming, durationExceededMessage } from '../src';

describe('buildTiming', () => {
  it('ceil-aligns audio + 0.6 s pad to frames without float drift', () => {
    // (2.0 + 0.6) * 30 = 78.00000000000001 in floats -> must be 78, not 79
    const t = buildTiming([2.0]);
    expect(t.sceneFrames).toEqual([78]);
    expect(t.audioFrames).toEqual([60]);
  });
  it('rounds partial frames up', () => {
    const t = buildTiming([1.234, 3.01]);
    expect(t.sceneFrames).toEqual([Math.ceil(1.834 * 30), Math.ceil(3.61 * 30)]); // 56, 109
    expect(t.startFrames).toEqual([0, 56]);
    expect(t.totalFrames).toBe(165);
    expect(t.videoSec).toBeCloseTo(5.5, 9);
  });
});

describe('assertWithinLimit', () => {
  it('passes at exactly 45 s', () => {
    expect(() => assertWithinLimit(buildTiming([44.4]), 'en-us')).not.toThrow();
  });
  it('throws DURATION_EXCEEDED above 45 s', () => {
    try {
      assertWithinLimit(buildTiming([50]), 'en-us');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PipelineError);
      expect((e as PipelineError).code).toBe('DURATION_EXCEEDED');
    }
  });
});

describe('durationExceededMessage', () => {
  it('states actual, maximum and how much to cut', () => {
    expect(durationExceededMessage(52.3, 'en-us')).toBe(
      'Narration produces a 52.3 s video; the maximum is 45 s. Shorten the script by about 7.3 s (≈ 21 words).',
    );
  });
});
