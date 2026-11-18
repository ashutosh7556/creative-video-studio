import { describe, expect, it } from 'vitest';
import { buildVideoSpec } from '../src';

describe('buildVideoSpec', () => {
  const spec = buildVideoSpec({
    texts: ['First scene. Short.', 'नमस्ते दोस्तों। आज हम सीखेंगे।', 'Third'],
    audioSecs: [2.0, 3.0, 1.0],
    lang: 'hi',
  });

  it('sets video format', () => {
    expect(spec).toMatchObject({ width: 1280, height: 720, fps: 30, lang: 'hi' });
  });
  it('uses Devanagari font stack for Hindi', () => {
    expect(spec.fontFamily).toBe('"Noto Sans Devanagari", "Inter"');
    expect(buildVideoSpec({ texts: ['a'], audioSecs: [1], lang: 'en-us' }).fontFamily).toBe('"Inter"');
  });
  it('lays scenes back to back and totals frames', () => {
    expect(spec.scenes.map((s) => [s.startFrame, s.frameCount])).toEqual([
      [0, 78],
      [78, 108],
      [186, 48],
    ]);
    expect(spec.totalFrames).toBe(234);
  });
  it('cycles camera moves and gives distinct seeds', () => {
    expect(spec.scenes.map((s) => s.cameraMove)).toEqual(['dolly', 'orbit', 'pushIn']);
    expect(new Set(spec.scenes.map((s) => s.seed)).size).toBe(3);
  });
  it('captions each scene from its start to its end', () => {
    for (const s of spec.scenes) {
      expect(s.captions[0].startFrame).toBe(s.startFrame);
      expect(s.captions.at(-1)!.endFrame).toBe(s.startFrame + s.frameCount);
    }
    expect(spec.scenes[1].captions.map((c) => c.text)).toEqual(['नमस्ते दोस्तों।', 'आज हम सीखेंगे।']);
  });
  it('rejects mismatched inputs', () => {
    expect(() => buildVideoSpec({ texts: ['a', 'b'], audioSecs: [1], lang: 'en-us' })).toThrow();
  });
});
