import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { checkPrereqs } from '../src/prereqs';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-prereq-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it('passes when ffmpeg, ffprobe, Chromium and the engine build are present', async () => {
  await writeFile(join(dir, 'index.html'), '');
  expect(await checkPrereqs(dir)).toEqual([]);
});

it('reports a missing engine build with the fix command', async () => {
  expect(await checkPrereqs(dir)).toEqual(['Scene engine is not built. Run: npm run build:engine']);
});
