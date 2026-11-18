import { MAX_SCENES } from './constants';
import { PipelineError } from './errors';

/** Splits a script into paragraphs. Never throws. Used by the UI for live counts. */
export function parseParagraphs(script: string): string[] {
  return script
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);
}

/** Splits and validates scenes. Throws PipelineError('SCRIPT_INVALID'). */
export function splitScenes(script: string): string[] {
  const scenes = parseParagraphs(script);
  if (scenes.length === 0) {
    throw new PipelineError('SCRIPT_INVALID', 'Script has no scenes. Separate scenes with a blank line.');
  }
  if (scenes.length > MAX_SCENES) {
    throw new PipelineError(
      'SCRIPT_INVALID',
      `Script has ${scenes.length} scenes; the maximum is ${MAX_SCENES}. Merge some paragraphs.`,
    );
  }
  return scenes;
}
