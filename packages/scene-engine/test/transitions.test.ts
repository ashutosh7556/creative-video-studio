import gsap from 'gsap';
import { describe, expect, it } from 'vitest';
import { cameraMoves, type CamState } from '../src/cameraMoves';

// GSAP attaches a private `_gsap` cache to tween targets, so compare camera fields only.
const pick = (s: CamState): CamState => ({ radius: s.radius, angle: s.angle, y: s.y, fov: s.fov, lookY: s.lookY });
import { mulberry32 } from '../src/rng';
import { dipAlpha } from '../src/transitions';

describe('dipAlpha', () => {
  it('is black at first and last frame, clear in the middle', () => {
    expect(dipAlpha(0, 90, 6)).toBe(1);
    expect(dipAlpha(89, 90, 6)).toBe(1);
    expect(dipAlpha(45, 90, 6)).toBe(0);
  });
  it('ramps linearly over the transition frames', () => {
    expect(dipAlpha(3, 90, 6)).toBeCloseTo(0.5);
    expect(dipAlpha(6, 90, 6)).toBe(0);
    expect(dipAlpha(86, 90, 6)).toBeCloseTo(0.5);
  });
});

describe('mulberry32', () => {
  it('is deterministic per seed and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
    expect(mulberry32(43)()).not.toBe(xs[0]);
  });
});

describe('cameraMoves', () => {
  it('produce identical state when a timeline is seeked out of order', () => {
    for (const move of Object.values(cameraMoves)) {
      const s = { ...move.initial };
      const tl = gsap.timeline({ paused: true });
      move.build(tl, s, 3);
      tl.seek(2, false);
      const atTwo = pick(s);
      tl.seek(0.5, false);
      tl.seek(2.9, false);
      tl.seek(2, false);
      expect(pick(s)).toEqual(atTwo);
      expect(atTwo).not.toEqual(move.initial); // the move actually changed something
      tl.seek(0, false);
      // GSAP writes tweened values rounded to 6 decimals, so compare the start state with tolerance.
      const back = pick(s);
      for (const k of Object.keys(move.initial) as (keyof CamState)[]) {
        expect(back[k]).toBeCloseTo(move.initial[k], 5);
      }
    }
  });
});
