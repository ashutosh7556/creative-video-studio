import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a']);

export const BGM_MISSING_WARNING =
  'Background music was enabled but no file was found in assets/music; the video was rendered without music.';

/** First supported audio file in dir by name, or null. Never throws. */
export async function findBgm(dir: string): Promise<string | null> {
  try {
    const files = (await readdir(dir)).filter((f) => EXTS.has(extname(f).toLowerCase())).sort();
    return files.length ? join(dir, files[0]) : null;
  } catch {
    return null;
  }
}
