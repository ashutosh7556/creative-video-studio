import { describe, expect, it } from 'vitest';
import { PipelineError, parseParagraphs, splitScenes } from '../src';

describe('parseParagraphs', () => {
  it('splits on blank lines and trims', () => {
    expect(parseParagraphs('  One.  \n\nTwo.\n\n\n  Three. ')).toEqual(['One.', 'Two.', 'Three.']);
  });
  it('handles CRLF and whitespace-only separator lines', () => {
    expect(parseParagraphs('One.\r\n   \r\nTwo.')).toEqual(['One.', 'Two.']);
  });
  it('joins wrapped lines inside a paragraph with spaces', () => {
    expect(parseParagraphs('Line a\nline b\n\nNext')).toEqual(['Line a line b', 'Next']);
  });
  it('returns [] for empty input', () => {
    expect(parseParagraphs('  \n\n ')).toEqual([]);
  });
});

describe('splitScenes', () => {
  it('returns paragraphs', () => {
    expect(splitScenes('A\n\nB')).toEqual(['A', 'B']);
  });
  it('throws SCRIPT_INVALID for zero scenes', () => {
    expect(() => splitScenes('   ')).toThrowError(PipelineError);
    try {
      splitScenes('');
    } catch (e) {
      expect((e as PipelineError).code).toBe('SCRIPT_INVALID');
    }
  });
  it('allows 12 scenes and rejects 13', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `S${i}`).join('\n\n');
    expect(splitScenes(twelve)).toHaveLength(12);
    const thirteen = Array.from({ length: 13 }, (_, i) => `S${i}`).join('\n\n');
    expect(() => splitScenes(thirteen)).toThrowError(/13 scenes; the maximum is 12/);
  });
});
