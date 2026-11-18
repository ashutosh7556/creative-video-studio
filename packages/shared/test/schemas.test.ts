import { describe, expect, it } from 'vitest';
import { JobRequestSchema, PipelineError } from '../src';

const valid = { script: 'Hello world.', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false };

describe('JobRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(JobRequestSchema.safeParse(valid).success).toBe(true);
  });
  it('trims and rejects an empty script', () => {
    expect(JobRequestSchema.safeParse({ ...valid, script: '   ' }).success).toBe(false);
  });
  it('rejects unknown languages', () => {
    expect(JobRequestSchema.safeParse({ ...valid, lang: 'fr' }).success).toBe(false);
  });
  it('rejects speed outside 0.5..1.5', () => {
    expect(JobRequestSchema.safeParse({ ...valid, speed: 0.4 }).success).toBe(false);
    expect(JobRequestSchema.safeParse({ ...valid, speed: 1.6 }).success).toBe(false);
  });
  it('rejects malformed voice ids', () => {
    expect(JobRequestSchema.safeParse({ ...valid, voice: '../x' }).success).toBe(false);
  });
  it('rejects scripts over 6000 chars', () => {
    expect(JobRequestSchema.safeParse({ ...valid, script: 'a'.repeat(6001) }).success).toBe(false);
  });
});

describe('PipelineError', () => {
  it('carries a code', () => {
    const e = new PipelineError('TTS_FAILED', 'Scene 1: boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('TTS_FAILED');
    expect(e.message).toBe('Scene 1: boom');
  });
});
