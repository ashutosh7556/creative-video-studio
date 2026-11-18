# Creative Video Studio MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a pasted script into a 30–45 s, 1280×720, 30 fps narrated MP4 of animated 3D title cards (English or Hindi), driven from a React dashboard, running locally.

**Architecture:** npm-workspaces monorepo. `packages/shared` holds pure logic (scene splitting, caption chunking, frame-aligned timing, VideoSpec). `services/tts` is a Python FastAPI + kokoro-onnx sidecar. `packages/scene-engine` is a deterministic Three.js + GSAP page that Puppeteer steps frame by frame. `apps/api` is an Express API that owns `job.json` and forks one render worker process per job; the worker calls TTS, builds sample-exact narration with FFmpeg, renders frames through Puppeteer and pipes them into FFmpeg. `apps/web` is a React + Tailwind dashboard that polls job status.

**Tech Stack:** Node ≥ 20 (dev machine: 24), TypeScript 5.9, npm workspaces, Vitest 5, zod 4, Express 5, Puppeteer 25, Three.js 0.187, GSAP 3.15, Vite 8, React 19, Tailwind 4, Python 3.12 via uv, FastAPI, kokoro-onnx 0.6, FFmpeg 9.

**Spec:** `docs/superpowers/specs/2026-11-18-creative-video-studio-mvp-design.md`

---

## Conventions for every task

- Run all commands from the repo root `c:\Users\Skyllect Dev1\Desktop\Projects_2\creative-video-studio` in Git Bash unless the step says otherwise.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (omitted below for brevity, but always add it).
- TypeScript packages are consumed as source (no build step) except `scene-engine` (Vite build) and `web` (Vite build). Imports inside packages are extensionless (`moduleResolution: bundler`; tsx and Vite resolve them).

## File map

```
package.json, tsconfig.base.json, vitest.config.ts, .gitignore, README.md
scripts/download-fonts.mjs                 font fetcher (run once, fonts committed)
scripts/smoke.ts, scripts/fixtures/{en,hi,long}.txt
assets/fonts/{Inter.ttf,NotoSansDevanagari.ttf,OFL-*.txt}
assets/music/.gitkeep

packages/shared/src/
  constants.ts      limits, rates, defaults, Chrome flags
  schemas.ts        zod JobRequest + JobRecord/VideoSpec/ApiConfig types
  errors.ts         PipelineError(code, message)
  scenes.ts         parseParagraphs, splitScenes
  estimate.ts       countWords, estimateDurationSec
  captions.ts       splitSentences, chunkCaption, timeCaptions
  timing.ts         buildTiming, durationExceededMessage, assertWithinLimit
  spec.ts           buildVideoSpec
  index.ts          barrel
packages/shared/test/*.test.ts

services/tts/
  pyproject.toml, .python-version
  app/__init__.py, app/voices.py (pure), app/main.py (FastAPI)
  scripts/download_models.py
  tests/test_voices.py, tests/test_api.py

packages/scene-engine/
  index.html, vite.config.ts, vitest.config.ts
  src/main.ts            window.__engine bridge
  src/engine.ts          createEngine
  src/rng.ts             mulberry32
  src/fonts.ts           FontFace loading + assertion
  src/transitions.ts     dipAlpha
  src/cameraMoves.ts     dolly/orbit/pushIn registry
  src/captionDraw.ts     wrapLines, drawCaption
  src/templates/registry.ts, src/templates/titleCard.ts
  test/transitions.test.ts, test/engine.browser.test.ts

apps/api/src/
  config.ts, ids.ts, atomicWrite.ts, jobStore.ts
  proc.ts           runProcess, tail
  ffmpeg.ts         probes, arg builders, checkVideo
  bgm.ts            findBgm
  ttsClient.ts      TtsClient (health, voices, synthesize w/ retry)
  render.ts         renderVideo (Puppeteer → FFmpeg)
  pipeline.ts       runPipeline
  worker/messages.ts, worker/index.ts
  runner.ts         JobRunner, LocalForkRunner
  recovery.ts       recoverJobs, cleanupJobs
  prereqs.ts        checkPrereqs
  app.ts            createApp (routes)
  server.ts         entry
apps/api/test/**

apps/web/
  index.html, vite.config.ts, vercel.json
  src/main.tsx, src/index.css, src/api.ts, src/App.tsx
  src/hooks/useJobPolling.ts
  src/components/{ScriptForm,OutputPanel,RecentJobs}.tsx
```

---

## Phase 1 — Foundation and shared logic

### Task 1: Monorepo scaffold

**Files:**
- Delete: `server.js` (empty, untracked)
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `assets/music/.gitkeep`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`

- [ ] **Step 1: Remove the placeholder file**

```bash
rm server.js
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "creative-video-studio",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "concurrently -n tts,api,web -c magenta,blue,green \"npm:dev:tts\" \"npm:dev:api\" \"npm:dev:web\"",
    "dev:tts": "cd services/tts && uv run uvicorn app.main:app --port 8001",
    "dev:api": "npm run dev -w @cvs/api",
    "dev:web": "npm run dev -w @cvs/web",
    "build:engine": "npm run build -w @cvs/scene-engine",
    "build": "npm run build:engine && npm run build -w @cvs/web",
    "test": "vitest run",
    "test:tts": "cd services/tts && uv run pytest -q",
    "setup:tts": "cd services/tts && uv sync && uv run python scripts/download_models.py",
    "fonts": "node scripts/download-fonts.mjs",
    "smoke:en": "tsx scripts/smoke.ts en",
    "smoke:hi": "tsx scripts/smoke.ts hi",
    "smoke:long": "tsx scripts/smoke.ts long",
    "typecheck": "tsc -p packages/shared && tsc -p packages/scene-engine && tsc -p apps/api && tsc -p apps/web"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "concurrently": "^10.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^5.1.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "allowImportingTsExtensions": false,
    "types": ["node"]
  }
}
```

- [ ] **Step 4: Create root `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globs so projects appear as packages are created; --project filters use package names (@cvs/*).
    projects: ['packages/*', 'apps/*/vitest.config.ts'],
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```gitignore
node_modules/
dist/
data/
test-artifacts/
*.log
.env
.env.*
services/tts/.venv/
services/tts/models/
__pycache__/
.pytest_cache/
assets/music/*
!assets/music/.gitkeep
```

Then: `mkdir -p assets/music && touch assets/music/.gitkeep`

- [ ] **Step 6: Create `packages/shared/package.json`**

```json
{
  "name": "@cvs/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^4.0.0" }
}
```

`packages/shared/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/shared/src/index.ts` (temporary, filled in later tasks):

```ts
export {};
```

- [ ] **Step 7: Install and verify**

Run: `npm install`
Expected: completes, creates `node_modules/@cvs/shared` symlink.

Run: `npx vitest run --project @cvs/shared`
Expected: "No test files found" (exit code 1 is fine here; it proves Vitest resolves the project).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json vitest.config.ts .gitignore assets/music/.gitkeep packages/shared
git commit -m "chore: scaffold npm workspaces monorepo"
```

---

### Task 2: Shared constants, schemas, errors

**Files:**
- Create: `packages/shared/src/constants.ts`, `packages/shared/src/schemas.ts`, `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/schemas.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/shared/test/schemas.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project @cvs/shared`
Expected: FAIL — `JobRequestSchema` is not exported.

- [ ] **Step 3: Implement** — `packages/shared/src/constants.ts`

```ts
export const WIDTH = 1280;
export const HEIGHT = 720;
export const FPS = 30;
/** Audio samples per video frame at 48 kHz / 30 fps. */
export const SAMPLES_PER_FRAME = 1600;
export const AUDIO_SAMPLE_RATE = 48000;

export const MAX_SCENES = 12;
export const MAX_DURATION_SEC = 45;
export const MIN_TARGET_SEC = 30;
export const SCENE_PAD_SEC = 0.6;
export const MAX_SCRIPT_CHARS = 6000;

export const LANGS = ['en-us', 'en-gb', 'hi'] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
  'en-us': 'English (US)',
  'en-gb': 'English (UK)',
  hi: 'Hindi',
};

/** Words per second at speed 1.0, measured with kokoro-onnx on 2026-11-18. */
export const SPEAKING_RATES: Record<Lang, number> = { 'en-us': 2.8, 'en-gb': 2.8, hi: 2.4 };

export const CAPTION_MAX_CHARS: Record<Lang, number> = { 'en-us': 70, 'en-gb': 70, hi: 60 };

export const DEFAULT_VOICES: Record<Lang, string> = {
  'en-us': 'af_heart',
  'en-gb': 'bf_emma',
  hi: 'hf_alpha',
};

export const CAMERA_MOVES = ['dolly', 'orbit', 'pushIn'] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

/** Dip-to-black length at each scene edge (0.2 s). */
export const TRANSITION_FRAMES = 6;
export const CAPTION_FADE_SEC = 0.2;

export const BGM_VOLUME = 0.12;
export const BGM_FADE_SEC = 1.5;

/** Chromium flags shared by the render worker and engine tests (same environment). */
export const CHROME_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
] as const;
```

`packages/shared/src/schemas.ts`:

```ts
import { z } from 'zod';
import { LANGS, MAX_SCRIPT_CHARS, type CameraMove, type Lang } from './constants';

export const JobRequestSchema = z.object({
  script: z
    .string()
    .trim()
    .min(1, 'Script is empty')
    .max(MAX_SCRIPT_CHARS, `Script is longer than ${MAX_SCRIPT_CHARS} characters`),
  lang: z.enum(LANGS),
  voice: z.string().regex(/^[a-z]{2}_[a-z]+$/, 'Invalid voice id'),
  speed: z.number().min(0.5).max(1.5),
  bgm: z.boolean(),
});
export type JobRequest = z.infer<typeof JobRequestSchema>;

export const ERROR_CODES = [
  'SCRIPT_INVALID',
  'TTS_UNAVAILABLE',
  'TTS_FAILED',
  'DURATION_EXCEEDED',
  'RENDER_FAILED',
  'ENCODE_FAILED',
  'INTERRUPTED',
  'WORKER_CRASHED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';
export type JobStage = 'tts' | 'audio' | 'render';

export interface JobRecord {
  id: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  request: JobRequest;
  status: JobStatus;
  stage?: JobStage;
  progress: number;
  warnings: string[];
  error?: { code: ErrorCode; message: string };
  result?: { durationSec: number; sceneCount: number };
}

export interface CaptionCue {
  text: string;
  /** Inclusive. */
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
}

export interface SceneSpec {
  index: number;
  text: string;
  startFrame: number;
  frameCount: number;
  template: 'titleCard';
  cameraMove: CameraMove;
  seed: number;
  captions: CaptionCue[];
}

export interface VideoSpec {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  lang: Lang;
  fontFamily: string;
  scenes: SceneSpec[];
}

export interface ApiConfig {
  bgmAvailable: boolean;
  maxScenes: number;
  maxDurationSec: number;
  minTargetSec: number;
  rates: Record<Lang, number>;
}

export type VoicesByLang = Record<Lang, string[]>;

export interface HealthStatus {
  api: 'ok';
  tts: 'ok' | 'unreachable';
}
```

`packages/shared/src/errors.ts`:

```ts
import type { ErrorCode } from './schemas';

export class PipelineError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

`packages/shared/src/index.ts`:

```ts
export * from './constants';
export * from './schemas';
export * from './errors';
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project @cvs/shared`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add constants, job schemas and PipelineError"
```

---

### Task 3: Scene splitting and duration estimate

**Files:**
- Create: `packages/shared/src/scenes.ts`, `packages/shared/src/estimate.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/scenes.test.ts`, `packages/shared/test/estimate.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/shared/test/scenes.test.ts`

```ts
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
```

`packages/shared/test/estimate.test.ts`:

```ts
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
    // speed 2x would halve speech; speed 0.5 doubles it
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/shared`
Expected: FAIL — `parseParagraphs` / `countWords` not exported.

- [ ] **Step 3: Implement** — `packages/shared/src/scenes.ts`

```ts
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
```

`packages/shared/src/estimate.ts`:

```ts
import { SCENE_PAD_SEC, SPEAKING_RATES, type Lang } from './constants';

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Rough pre-TTS estimate of final video length. The worker's post-TTS check is authoritative. */
export function estimateDurationSec(scenes: string[], lang: Lang, speed: number): number {
  const rate = SPEAKING_RATES[lang] * speed;
  return scenes.reduce((sum, text) => sum + countWords(text) / rate + SCENE_PAD_SEC, 0);
}
```

Append to `packages/shared/src/index.ts`:

```ts
export * from './scenes';
export * from './estimate';
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project @cvs/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add scene splitting and duration estimate"
```

---

### Task 4: Caption chunking and timing

**Files:**
- Create: `packages/shared/src/captions.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/captions.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/shared/test/captions.test.ts`

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/shared`
Expected: FAIL — `chunkCaption` not exported.

- [ ] **Step 3: Implement** — `packages/shared/src/captions.ts`

```ts
import type { CaptionCue } from './schemas';

/** Sentence ends at . ! ? । ॥ followed by whitespace (so "3.5" is not split). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।॥])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Splits text into caption chunks: per sentence, then words packed up to maxChars.
 * Splits only at whitespace, so Devanagari clusters are never broken.
 */
export function chunkCaption(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (const sentence of splitSentences(text)) {
    let current = '';
    for (const word of sentence.split(/\s+/)) {
      if (!current) current = word;
      else if (current.length + 1 + word.length <= maxChars) current += ` ${word}`;
      else {
        chunks.push(current);
        current = word;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

/**
 * Times chunks across the scene's audio frames proportionally to character count.
 * Cues are contiguous; the last cue extends to the scene end (covering the silent pad).
 */
export function timeCaptions(
  chunks: string[],
  startFrame: number,
  audioFrames: number,
  sceneFrames: number,
): CaptionCue[] {
  const totalChars = chunks.reduce((s, c) => s + c.length, 0);
  let acc = 0;
  return chunks.map((text, i) => {
    const start = startFrame + Math.round((audioFrames * acc) / totalChars);
    acc += text.length;
    const end =
      i === chunks.length - 1
        ? startFrame + sceneFrames
        : startFrame + Math.round((audioFrames * acc) / totalChars);
    return { text, startFrame: start, endFrame: end };
  });
}
```

Append to `index.ts`: `export * from './captions';`

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project @cvs/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add caption chunking and proportional timing"
```

---

### Task 5: Frame-aligned timing and VideoSpec builder

**Files:**
- Create: `packages/shared/src/timing.ts`, `packages/shared/src/spec.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/timing.test.ts`, `packages/shared/test/spec.test.ts`

- [ ] **Step 1: Write failing tests** — `packages/shared/test/timing.test.ts`

```ts
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
```

`packages/shared/test/spec.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/shared`
Expected: FAIL — `buildTiming` not exported.

- [ ] **Step 3: Implement** — `packages/shared/src/timing.ts`

```ts
import { FPS, MAX_DURATION_SEC, SCENE_PAD_SEC, SPEAKING_RATES, type Lang } from './constants';
import { PipelineError } from './errors';

export interface Timing {
  sceneFrames: number[];
  startFrames: number[];
  /** Frames covered by actual speech (for caption timing). */
  audioFrames: number[];
  totalFrames: number;
  videoSec: number;
}

const EPS = 1e-6;

export function buildTiming(audioSecs: number[]): Timing {
  const sceneFrames = audioSecs.map((a) => Math.ceil((a + SCENE_PAD_SEC) * FPS - EPS));
  const audioFrames = audioSecs.map((a, i) => Math.min(sceneFrames[i], Math.round(a * FPS)));
  const startFrames: number[] = [];
  let acc = 0;
  for (const f of sceneFrames) {
    startFrames.push(acc);
    acc += f;
  }
  return { sceneFrames, startFrames, audioFrames, totalFrames: acc, videoSec: acc / FPS };
}

export function durationExceededMessage(videoSec: number, lang: Lang): string {
  const over = videoSec - MAX_DURATION_SEC;
  const words = Math.ceil(over * SPEAKING_RATES[lang]);
  return (
    `Narration produces a ${videoSec.toFixed(1)} s video; the maximum is ${MAX_DURATION_SEC} s. ` +
    `Shorten the script by about ${over.toFixed(1)} s (≈ ${words} words).`
  );
}

export function assertWithinLimit(timing: Timing, lang: Lang): void {
  if (timing.videoSec > MAX_DURATION_SEC + EPS) {
    throw new PipelineError('DURATION_EXCEEDED', durationExceededMessage(timing.videoSec, lang));
  }
}
```

Note: `durationExceededMessage(52.3)` → over = 7.3 (float 7.299999…), `toFixed(1)` = "7.3", words = ceil(7.2999…×2.8 = 20.44) = 21. Matches the test.

`packages/shared/src/spec.ts`:

```ts
import { CAMERA_MOVES, CAPTION_MAX_CHARS, FPS, HEIGHT, WIDTH, type Lang } from './constants';
import { chunkCaption, timeCaptions } from './captions';
import type { VideoSpec } from './schemas';
import { buildTiming } from './timing';

export interface BuildSpecInput {
  texts: string[];
  audioSecs: number[];
  lang: Lang;
  seedBase?: number;
}

export function buildVideoSpec({ texts, audioSecs, lang, seedBase = 1 }: BuildSpecInput): VideoSpec {
  if (texts.length !== audioSecs.length) {
    throw new Error(`texts (${texts.length}) and audioSecs (${audioSecs.length}) length mismatch`);
  }
  const t = buildTiming(audioSecs);
  return {
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    totalFrames: t.totalFrames,
    lang,
    fontFamily: lang === 'hi' ? '"Noto Sans Devanagari", "Inter"' : '"Inter"',
    scenes: texts.map((text, i) => ({
      index: i,
      text,
      startFrame: t.startFrames[i],
      frameCount: t.sceneFrames[i],
      template: 'titleCard' as const,
      cameraMove: CAMERA_MOVES[i % CAMERA_MOVES.length],
      seed: seedBase * 1000 + i + 1,
      captions: timeCaptions(
        chunkCaption(text, CAPTION_MAX_CHARS[lang]),
        t.startFrames[i],
        t.audioFrames[i],
        t.sceneFrames[i],
      ),
    })),
  };
}
```

Append to `index.ts`:

```ts
export * from './timing';
export * from './spec';
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project @cvs/shared`
Expected: PASS. Check scene frames in spec test: 2.0→78, 3.0→ceil(108)=108, 1.0→48 ✔.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -p packages/shared`
Expected: no output.

```bash
git add packages/shared
git commit -m "feat(shared): add frame-aligned timing, duration limit and VideoSpec builder"
```

---

## Phase 2 — TTS service

### Task 6: TTS project and pure voice logic

**Files:**
- Create: `services/tts/pyproject.toml`, `services/tts/.python-version`, `services/tts/app/__init__.py`, `services/tts/app/voices.py`
- Test: `services/tts/tests/test_voices.py`

- [ ] **Step 1: Create project files**

`services/tts/.python-version`:

```
3.12
```

`services/tts/pyproject.toml`:

```toml
[project]
name = "cvs-tts"
version = "0.1.0"
description = "Kokoro TTS sidecar for Creative Video Studio"
requires-python = ">=3.12,<3.13"
dependencies = [
  "fastapi>=0.115",
  "uvicorn>=0.30",
  "kokoro-onnx>=0.6.1",
  "soundfile>=0.13",
  "numpy>=1.26",
]

[dependency-groups]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

`services/tts/app/__init__.py`: empty file.

Run: `cd services/tts && uv sync`
Expected: creates `.venv` with Python 3.12, installs deps (kokoro-onnx 0.6.x, espeakng-loader).

- [ ] **Step 2: Write failing test** — `services/tts/tests/test_voices.py`

```python
import pytest

from app.voices import TtsValidationError, group_voices, validate_request

ALL = {"af_heart", "am_adam", "bf_emma", "bm_george", "hf_alpha", "hf_beta", "hm_omega", "hm_psi", "jf_alpha", "zf_xiaobei"}


def test_group_voices_by_prefix_and_ignores_other_languages():
    g = group_voices(ALL)
    assert g == {
        "en-us": ["af_heart", "am_adam"],
        "en-gb": ["bf_emma", "bm_george"],
        "hi": ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"],
    }


def test_valid_request_passes():
    validate_request("नमस्ते", "hi", "hf_alpha", 1.0, ALL)


@pytest.mark.parametrize(
    "text,lang,voice,speed,msg",
    [
        ("   ", "hi", "hf_alpha", 1.0, "Text is empty"),
        ("hi", "fr", "af_heart", 1.0, "Unsupported language"),
        ("hi", "hi", "hf_nope", 1.0, "Unknown voice"),
        ("hi", "hi", "af_heart", 1.0, "does not match language"),
        ("hi", "en-us", "af_heart", 0.4, "Speed must be"),
        ("hi", "en-us", "af_heart", 1.6, "Speed must be"),
    ],
)
def test_invalid_requests(text, lang, voice, speed, msg):
    with pytest.raises(TtsValidationError, match=msg):
        validate_request(text, lang, voice, speed, ALL)
```

- [ ] **Step 3: Run to verify failure**

Run: `cd services/tts && uv run pytest tests/test_voices.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.voices'`.

- [ ] **Step 4: Implement** — `services/tts/app/voices.py`

```python
"""Pure voice/language logic. No model access, fully unit-testable."""

LANG_BY_PREFIX = {"a": "en-us", "b": "en-gb", "h": "hi"}
# Our language id -> espeak-ng language passed to kokoro-onnx
ESPEAK_LANG = {"en-us": "en-us", "en-gb": "en-gb", "hi": "hi"}
MIN_SPEED, MAX_SPEED = 0.5, 1.5


class TtsValidationError(ValueError):
    pass


def group_voices(names) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {lang: [] for lang in ESPEAK_LANG}
    for name in sorted(names):
        lang = LANG_BY_PREFIX.get(name[:1])
        if lang and len(name) > 3 and name[2] == "_":
            out[lang].append(name)
    return out


def validate_request(text: str, lang: str, voice: str, speed: float, available: set[str]) -> None:
    if not text or not text.strip():
        raise TtsValidationError("Text is empty")
    if lang not in ESPEAK_LANG:
        raise TtsValidationError(f"Unsupported language '{lang}'. Use one of: {', '.join(ESPEAK_LANG)}")
    if voice not in available:
        raise TtsValidationError(f"Unknown voice '{voice}'")
    if LANG_BY_PREFIX.get(voice[:1]) != lang:
        raise TtsValidationError(f"Voice '{voice}' does not match language '{lang}'")
    if not (MIN_SPEED <= speed <= MAX_SPEED):
        raise TtsValidationError(f"Speed must be between {MIN_SPEED} and {MAX_SPEED}")
```

- [ ] **Step 5: Run to verify pass**

Run: `cd services/tts && uv run pytest tests/test_voices.py -q`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add services/tts/pyproject.toml services/tts/uv.lock services/tts/.python-version services/tts/app services/tts/tests
git commit -m "feat(tts): add uv project and voice validation logic"
```

---

### Task 7: TTS FastAPI app and model download

**Files:**
- Create: `services/tts/scripts/download_models.py`, `services/tts/app/main.py`
- Test: `services/tts/tests/test_download.py`, `services/tts/tests/test_api.py`

- [ ] **Step 1: Model download script with integrity check** — `services/tts/scripts/download_models.py`

Files are verified by size **and SHA-256**. Digests are the ones GitHub publishes for the `model-files-v1.1` release assets (`GET /repos/thewh1teagle/kokoro-onnx/releases/tags/model-files-v1.1` → `assets[].digest`). Valid files are skipped; invalid ones are re-downloaded; a corrupted download is deleted and the script exits non-zero.

Failing test first — `services/tts/tests/test_download.py`:

```python
import hashlib
import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "download_models.py"
spec = importlib.util.spec_from_file_location("download_models", SCRIPT)
dm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dm)


def test_pins_official_sha256_and_sizes():
    assert dm.FILES["kokoro-v1.0.onnx"] == (
        325_505_369,
        "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    )
    assert dm.FILES["voices-v1.0.bin"] == (
        28_214_398,
        "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    )


def test_is_valid_accepts_matching_file(tmp_path):
    f = tmp_path / "m.bin"
    f.write_bytes(b"hello")
    assert dm.is_valid(f, 5, hashlib.sha256(b"hello").hexdigest())


def test_is_valid_rejects_wrong_size_hash_or_missing(tmp_path):
    f = tmp_path / "m.bin"
    f.write_bytes(b"hellx")
    assert not dm.is_valid(f, 5, hashlib.sha256(b"hello").hexdigest())  # same size, corrupted
    assert not dm.is_valid(f, 6, hashlib.sha256(b"hellx").hexdigest())  # wrong size
    assert not dm.is_valid(tmp_path / "missing.bin", 5, "0" * 64)
```

Run: `cd services/tts && uv run pytest tests/test_download.py -q` → FAIL (script missing).

Implementation:

```python
"""Downloads Kokoro v1.0 ONNX model files into services/tts/models.

Each file is verified by size and SHA-256 (digests published by GitHub for the
model-files-v1.1 release). Valid existing files are skipped; invalid ones are re-downloaded.
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1"
FILES = {
    "kokoro-v1.0.onnx": (325_505_369, "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a"),
    "voices-v1.0.bin": (28_214_398, "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"),
}
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def is_valid(path: Path, size: int, sha256: str) -> bool:
    return path.exists() and path.stat().st_size == size and sha256_of(path) == sha256


def download(name: str, size: int, sha256: str) -> None:
    dest = MODELS_DIR / name
    if is_valid(dest, size, sha256):
        print(f"[skip] {name} already present and verified")
        return
    tmp = dest.with_suffix(dest.suffix + ".part")

    def hook(blocks: int, block_size: int, total: int) -> None:
        done = min(blocks * block_size, total or size)
        sys.stdout.write(f"\r[download] {name}: {done / 1e6:6.1f} / {(total or size) / 1e6:.1f} MB")
        sys.stdout.flush()

    urllib.request.urlretrieve(f"{BASE}/{name}", tmp, hook)
    print()
    if not is_valid(tmp, size, sha256):
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"{name}: size or SHA-256 mismatch, download corrupted. Re-run the script.")
    tmp.replace(dest)
    print(f"[ok] {name} verified (sha256 {sha256[:12]}...)")


if __name__ == "__main__":
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for n, (s, h) in FILES.items():
        download(n, s, h)
    print(f"Models ready in {MODELS_DIR}")
```

Run: `cd services/tts && uv run pytest tests/test_download.py -q` → 3 passed.

Run: `npm run setup:tts`
Expected: `[ok] kokoro-v1.0.onnx verified (sha256 beb0d1848dee...)`, `[ok] voices-v1.0.bin verified (...)` (or `[skip] … already present and verified`), then `Models ready in …\services\tts\models`.

- [ ] **Step 2: Write failing API tests** — `services/tts/tests/test_api.py`

```python
import io
from pathlib import Path

import pytest
import soundfile as sf

MODELS = Path(__file__).resolve().parent.parent / "models"
pytestmark = pytest.mark.skipif(
    not (MODELS / "kokoro-v1.0.onnx").exists(), reason="models not downloaded (npm run setup:tts)"
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:  # runs lifespan -> loads model once
        yield c


def test_health(client):
    assert client.get("/health").json() == {"ok": True, "model": "kokoro-v1.0"}


def test_voices_include_all_hindi(client):
    v = client.get("/voices").json()
    assert v["hi"] == ["hf_alpha", "hf_beta", "hm_omega", "hm_psi"]
    assert "af_heart" in v["en-us"]
    assert "bf_emma" in v["en-gb"]


def test_lang_voice_mismatch_is_400(client):
    r = client.post("/synthesize", json={"text": "नमस्ते", "lang": "hi", "voice": "af_heart", "speed": 1.0})
    assert r.status_code == 400
    assert "does not match" in r.json()["error"]


def test_bad_speed_is_400(client):
    r = client.post("/synthesize", json={"text": "hi", "lang": "en-us", "voice": "af_heart", "speed": 3})
    assert r.status_code == 400


def test_missing_field_is_400_not_422(client):
    r = client.post("/synthesize", json={"text": "hi"})
    assert r.status_code == 400


@pytest.mark.parametrize(
    "text,lang,voice",
    [("Hello friends.", "en-us", "af_heart"), ("नमस्ते दोस्तों। सूर्य एक तारा है।", "hi", "hf_alpha")],
)
def test_synthesize_returns_24k_mono_wav(client, text, lang, voice):
    r = client.post("/synthesize", json={"text": text, "lang": lang, "voice": voice, "speed": 1.0})
    assert r.status_code == 200
    assert r.headers["content-type"] == "audio/wav"
    data, sr = sf.read(io.BytesIO(r.content))
    assert sr == 24000
    assert data.ndim == 1
    dur = len(data) / sr
    assert dur > 0.5
    assert abs(float(r.headers["x-duration"]) - dur) < 0.01


def test_model_loaded_once(client):
    first = id(client.app.state.kokoro)
    client.post("/synthesize", json={"text": "One.", "lang": "en-us", "voice": "af_heart", "speed": 1.0})
    client.post("/synthesize", json={"text": "Two.", "lang": "en-us", "voice": "af_heart", "speed": 1.0})
    assert id(client.app.state.kokoro) == first
    assert client.app.state.load_count == 1
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:tts`
Expected: FAIL — `No module named 'app.main'`.

- [ ] **Step 4: Implement** — `services/tts/app/main.py`

```python
"""Kokoro TTS sidecar. Model loads once at startup; inference is serialised by a lock."""
import io
import os
import sys
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from kokoro_onnx import Kokoro
from pydantic import BaseModel

from .voices import ESPEAK_LANG, TtsValidationError, group_voices, validate_request

# Windows consoles default to cp1252; IPA/Devanagari in logs would crash prints.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8")

MODELS_DIR = Path(os.environ.get("KOKORO_MODELS_DIR", Path(__file__).resolve().parent.parent / "models"))
MODEL_FILE = MODELS_DIR / "kokoro-v1.0.onnx"
VOICES_FILE = MODELS_DIR / "voices-v1.0.bin"


def load_kokoro() -> Kokoro:
    missing = [p.name for p in (MODEL_FILE, VOICES_FILE) if not p.exists()]
    if missing:
        raise RuntimeError(f"Missing model files in {MODELS_DIR}: {', '.join(missing)}. Run: npm run setup:tts")
    return Kokoro(str(MODEL_FILE), str(VOICES_FILE))


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.kokoro = load_kokoro()
    app.state.load_count = getattr(app.state, "load_count", 0) + 1
    app.state.voices = set(app.state.kokoro.get_voices())
    app.state.lock = threading.Lock()
    yield


app = FastAPI(title="cvs-tts", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_to_400(_req: Request, exc: RequestValidationError):
    msg = "; ".join(f"{'.'.join(str(p) for p in e['loc'][1:]) or 'body'}: {e['msg']}" for e in exc.errors())
    return JSONResponse(status_code=400, content={"error": msg})


class SynthRequest(BaseModel):
    text: str
    lang: str
    voice: str
    speed: float = 1.0


@app.get("/health")
def health():
    return {"ok": True, "model": "kokoro-v1.0"}


@app.get("/voices")
def voices(request: Request):
    return group_voices(request.app.state.voices)


@app.post("/synthesize")
def synthesize(body: SynthRequest, request: Request):
    st = request.app.state
    try:
        validate_request(body.text, body.lang, body.voice, body.speed, st.voices)
    except TtsValidationError as e:
        return JSONResponse(status_code=400, content={"error": str(e)})
    try:
        with st.lock:
            samples, sr = st.kokoro.create(
                body.text.strip(), voice=body.voice, speed=body.speed, lang=ESPEAK_LANG[body.lang]
            )
    except Exception as e:  # noqa: BLE001 - report any inference failure to caller
        return JSONResponse(status_code=500, content={"error": f"Synthesis failed: {e}"})
    buf = io.BytesIO()
    sf.write(buf, samples, sr, format="WAV", subtype="PCM_16")
    return Response(
        content=buf.getvalue(),
        media_type="audio/wav",
        headers={"X-Duration": f"{len(samples) / sr:.4f}"},
    )
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:tts`
Expected: all tests pass (19 incl. download tests). First run loads the model (~2 s).

- [ ] **Step 6: Manual check of the dev server**

Run: `npm run dev:tts` (separate terminal), then:
`curl -s http://localhost:8001/voices`
Expected: JSON with `"hi":["hf_alpha","hf_beta","hm_omega","hm_psi"]`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add services/tts
git commit -m "feat(tts): add FastAPI Kokoro service with one-time model load"
```

---

## Phase 3 — Scene engine

### Task 8: Fonts and engine package scaffold

**Files:**
- Create: `scripts/download-fonts.mjs`, `assets/fonts/*` (downloaded)
- Create: `packages/scene-engine/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/vite-env.d.ts`

- [ ] **Step 1: Font download script** — `scripts/download-fonts.mjs`

```js
// Fetches OFL fonts into assets/fonts. Run once; the fonts are committed.
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://github.com/google/fonts/raw/main/ofl';
const FILES = [
  [`${BASE}/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf`, 'NotoSansDevanagari.ttf'],
  [`${BASE}/notosansdevanagari/OFL.txt`, 'OFL-NotoSansDevanagari.txt'],
  [`${BASE}/inter/Inter%5Bopsz,wght%5D.ttf`, 'Inter.ttf'],
  [`${BASE}/inter/OFL.txt`, 'OFL-Inter.txt'],
];

await mkdir('assets/fonts', { recursive: true });
for (const [url, name] of FILES) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (name.endsWith('.ttf') && buf.length < 100_000) throw new Error(`${name}: suspiciously small (${buf.length} B)`);
  await writeFile(`assets/fonts/${name}`, buf);
  console.log(`${name}: ${(buf.length / 1024).toFixed(0)} KB`);
}
```

Run: `npm run fonts`
Expected: four lines; both `.ttf` files several hundred KB.

- [ ] **Step 2: Engine package files**

`packages/scene-engine/package.json`:

```json
{
  "name": "@cvs/scene-engine",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "build": "vite build", "dev": "vite" },
  "dependencies": {
    "@cvs/shared": "*",
    "gsap": "^3.15.0",
    "three": "^0.187.0"
  },
  "devDependencies": {
    "@types/three": "^0.187.0",
    "puppeteer": "^25.0.0",
    "vite": "^8.0.0"
  }
}
```

`packages/scene-engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": ["node", "vite/client"] },
  "include": ["src", "test", "vite.config.ts"]
}
```

`packages/scene-engine/vite.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/engine/',
  // Bundled fonts are served at /engine/<file>.ttf
  publicDir: fileURLToPath(new URL('../../assets/fonts', import.meta.url)),
  build: { outDir: 'dist', emptyOutDir: true },
});
```

`packages/scene-engine/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
```

`packages/scene-engine/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>scene-engine</title>
    <style>html, body { margin: 0; background: #000; overflow: hidden; }</style>
  </head>
  <body>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`packages/scene-engine/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Run: `npm install`
Expected: installs three, gsap, puppeteer (downloads Chrome for Testing on first install).

- [ ] **Step 3: Commit**

```bash
git add scripts/download-fonts.mjs assets/fonts packages/scene-engine package-lock.json
git commit -m "chore(engine): scaffold scene-engine package and bundle OFL fonts"
```

---

### Task 9: Pure engine helpers (rng, transitions, camera moves)

**Files:**
- Create: `packages/scene-engine/src/rng.ts`, `src/transitions.ts`, `src/cameraMoves.ts`
- Test: `packages/scene-engine/test/transitions.test.ts`

- [ ] **Step 1: Write failing test** — `packages/scene-engine/test/transitions.test.ts`

```ts
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
```

Notes (found during execution): GSAP attaches a private `_gsap` cache to tween targets, so the test compares camera fields only via `pick()`; GSAP writes tweened values rounded to 6 decimals, so the return-to-start check uses `toBeCloseTo(…, 5)`. Out-of-order seek determinism stays exact.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/scene-engine test/transitions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement** — `packages/scene-engine/src/rng.ts`

```ts
/** Small seeded PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

`packages/scene-engine/src/transitions.ts`:

```ts
/** Black overlay alpha for a dip-to-black at both scene edges. Pure function of the frame. */
export function dipAlpha(localFrame: number, frameCount: number, transitionFrames: number): number {
  const fromStart = 1 - localFrame / transitionFrames;
  const fromEnd = 1 - (frameCount - 1 - localFrame) / transitionFrames;
  return Math.min(1, Math.max(0, fromStart, fromEnd));
}
```

`packages/scene-engine/src/cameraMoves.ts`:

```ts
import type { CameraMove } from '@cvs/shared';
import type gsap from 'gsap';
import type { PerspectiveCamera } from 'three';

export interface CamState {
  radius: number;
  angle: number; // radians around Y
  y: number;
  fov: number;
  lookY: number;
}

export interface CameraMoveDef {
  initial: CamState;
  build(tl: gsap.core.Timeline, state: CamState, durationSec: number): void;
}

const DEG = Math.PI / 180;

export const cameraMoves: Record<CameraMove, CameraMoveDef> = {
  dolly: {
    initial: { radius: 12, angle: 0, y: 1, fov: 50, lookY: 0 },
    build: (tl, s, d) => {
      tl.to(s, { radius: 8, y: 0.4, duration: d, ease: 'power2.inOut' }, 0);
    },
  },
  orbit: {
    initial: { radius: 10, angle: -25 * DEG, y: 0.8, fov: 50, lookY: 0 },
    build: (tl, s, d) => {
      tl.to(s, { angle: 25 * DEG, duration: d, ease: 'sine.inOut' }, 0);
    },
  },
  pushIn: {
    initial: { radius: 11, angle: 0.15, y: 0.6, fov: 58, lookY: 0.2 },
    build: (tl, s, d) => {
      tl.to(s, { radius: 9, fov: 44, lookY: 0, duration: d, ease: 'power1.inOut' }, 0);
    },
  },
};

export function applyCamera(camera: PerspectiveCamera, s: CamState): void {
  camera.position.set(Math.sin(s.angle) * s.radius, s.y, Math.cos(s.angle) * s.radius);
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(0, s.lookY, 0);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project @cvs/scene-engine test/transitions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/scene-engine
git commit -m "feat(engine): add seeded rng, dip transition and GSAP camera moves"
```

---

### Task 10: Template, captions, fonts, engine core and page bridge

No unit tests in this task (DOM/WebGL code). **Execution order:** write Task 11's browser test file first and watch it fail (build cannot resolve `src/main.ts`), then implement this task, then run Task 11. Commit Task 10 (src) and Task 11 (test) separately.

**Files:**
- Create: `packages/scene-engine/src/templates/registry.ts`, `src/templates/titleCard.ts`, `src/captionDraw.ts`, `src/fonts.ts`, `src/engine.ts`, `src/main.ts`

- [ ] **Step 1: Template registry** — `src/templates/registry.ts`

```ts
import type { SceneSpec } from '@cvs/shared';
import type { Group } from 'three';

export interface TemplateInstance {
  group: Group;
  background: number;
  /** Pure function of scene-local time in seconds. */
  update(tSec: number): void;
  dispose(): void;
}

export interface SceneTemplate {
  id: string;
  build(ctx: { scene: SceneSpec; rng: () => number }): TemplateInstance;
}

const registry = new Map<string, SceneTemplate>();

export function registerTemplate(t: SceneTemplate): void {
  registry.set(t.id, t);
}

export function getTemplate(id: string): SceneTemplate {
  const t = registry.get(id);
  if (!t) throw new Error(`Unknown scene template "${id}"`);
  return t;
}
```

- [ ] **Step 2: Title card template** — `src/templates/titleCard.ts`

```ts
import * as THREE from 'three';
import type { SceneTemplate } from './registry';

const PALETTES = [
  { bg: 0x0b1026, colors: [0x5b8cff, 0xff6bcb, 0xffd166, 0x06d6a0], rim: 0x8f5bff },
  { bg: 0x120b1f, colors: [0xff7a59, 0xffc15e, 0x9b5de5, 0x00bbf9], rim: 0xff4d6d },
  { bg: 0x04151f, colors: [0x2ec4b6, 0xcbf3f0, 0xff9f1c, 0xe71d36], rim: 0x2ec4b6 },
  { bg: 0x1a1a2e, colors: [0xe94560, 0x3d7bd9, 0xf5f5f5, 0x53bf9d], rim: 0xe94560 },
];

const TAU = Math.PI * 2;

export const titleCard: SceneTemplate = {
  id: 'titleCard',
  build({ rng }) {
    const range = (min: number, max: number) => min + rng() * (max - min);
    const pal = PALETTES[Math.floor(rng() * PALETTES.length)];
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];

    group.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(5, 6, 8);
    group.add(key);
    const rim = new THREE.PointLight(pal.rim, 40, 30);
    rim.position.set(-6, -2, -4);
    group.add(rim);

    const geometries = [
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.TorusGeometry(0.8, 0.28, 16, 48),
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.OctahedronGeometry(1, 0),
    ];
    disposables.push(...geometries);

    const count = 5 + Math.floor(rng() * 4);
    const shapes = Array.from({ length: count }, () => {
      const material = new THREE.MeshStandardMaterial({
        color: pal.colors[Math.floor(rng() * pal.colors.length)],
        roughness: 0.35,
        metalness: 0.2,
        flatShading: true,
      });
      disposables.push(material);
      const mesh = new THREE.Mesh(geometries[Math.floor(rng() * geometries.length)], material);
      const s = range(0.5, 1.3);
      mesh.scale.setScalar(s);
      const shape = {
        mesh,
        x: range(-7, 7),
        y: range(-3.5, 3.5),
        z: range(-6, 1),
        rx: range(0, TAU),
        ry: range(0, TAU),
        vx: range(-0.6, 0.6),
        vy: range(-0.6, 0.6),
        amp: range(0.2, 0.6),
        freq: range(0.3, 0.8),
        phase: range(0, TAU),
      };
      mesh.position.set(shape.x, shape.y, shape.z);
      group.add(mesh);
      return shape;
    });

    const positions = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      positions[i * 3] = range(-15, 15);
      positions[i * 3 + 1] = range(-9, 9);
      positions[i * 3 + 2] = range(-15, 5);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.7 });
    disposables.push(pGeo, pMat);
    const points = new THREE.Points(pGeo, pMat);
    group.add(points);

    return {
      group,
      background: pal.bg,
      update(t) {
        for (const s of shapes) {
          s.mesh.rotation.set(s.rx + s.vx * t, s.ry + s.vy * t, 0);
          s.mesh.position.y = s.y + Math.sin(t * s.freq * TAU + s.phase) * s.amp;
        }
        points.rotation.y = t * 0.03;
      },
      dispose() {
        for (const d of disposables) d.dispose();
      },
    };
  },
};
```

- [ ] **Step 3: Caption drawing** — `src/captionDraw.ts`

```ts
import { CAPTION_FADE_SEC, type CaptionCue } from '@cvs/shared';
import gsap from 'gsap';

const FONT_PX = 40;
const LINE_HEIGHT = 56;
const MAX_TEXT_WIDTH = 1100;
const PAD_X = 32;
const PAD_Y = 20;
const easeOut = gsap.parseEase('power2.out');

export function captionFont(fontFamily: string): string {
  return `600 ${FONT_PX}px ${fontFamily}`;
}

/** Greedy word wrap using real glyph metrics. Breaks only at spaces. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCaption(
  ctx: CanvasRenderingContext2D,
  cue: CaptionCue,
  frame: number,
  fps: number,
  fontFamily: string,
  width: number,
  height: number,
): void {
  const t = (frame - cue.startFrame) / fps;
  const e = easeOut(Math.min(1, t / CAPTION_FADE_SEC));
  ctx.save();
  ctx.globalAlpha = e;
  ctx.font = captionFont(fontFamily);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, cue.text, MAX_TEXT_WIDTH);
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = Math.min(width - 80, textW + PAD_X * 2);
  const h = lines.length * LINE_HEIGHT + PAD_Y * 2;
  const cy = height - 120 + (1 - e) * 12;
  const x = (width - w) / 2;
  const y = cy - h / 2;
  ctx.fillStyle = 'rgba(8, 10, 20, 0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  lines.forEach((l, i) => ctx.fillText(l, width / 2, y + PAD_Y + LINE_HEIGHT * i + LINE_HEIGHT / 2));
  ctx.restore();
}
```

- [ ] **Step 4: Fonts** — `src/fonts.ts`

```ts
const FONTS = [
  { family: 'Inter', file: 'Inter.ttf' },
  { family: 'Noto Sans Devanagari', file: 'NotoSansDevanagari.ttf' },
];

/** Loads bundled fonts and fails loudly if they are not usable (never render with fallback glyphs). */
export async function loadFonts(): Promise<void> {
  for (const f of FONTS) {
    const face = new FontFace(f.family, `url(${import.meta.env.BASE_URL}${f.file})`, { weight: '100 900' });
    await face.load();
    document.fonts.add(face);
  }
  await document.fonts.ready;
  if (!document.fonts.check('600 40px "Noto Sans Devanagari"', 'क')) {
    throw new Error('Noto Sans Devanagari failed to load');
  }
  if (!document.fonts.check('600 40px "Inter"', 'A')) {
    throw new Error('Inter failed to load');
  }
}
```

- [ ] **Step 5: Engine** — `src/engine.ts`

```ts
import { TRANSITION_FRAMES, type VideoSpec } from '@cvs/shared';
import gsap from 'gsap';
import * as THREE from 'three';
import { drawCaption } from './captionDraw';
import { applyCamera, cameraMoves, type CamState } from './cameraMoves';
import { loadFonts } from './fonts';
import { mulberry32 } from './rng';
import { getTemplate, registerTemplate, type TemplateInstance } from './templates/registry';
import { titleCard } from './templates/titleCard';
import { dipAlpha } from './transitions';

registerTemplate(titleCard);

export interface Engine {
  renderFrame(n: number): void;
  captureJpeg(quality: number): string;
  captureRawHash(): Promise<string>;
  dispose(): void;
}

interface BuiltScene {
  spec: VideoSpec['scenes'][number];
  inst: TemplateInstance;
  cam: CamState;
  tl: gsap.core.Timeline;
}

export async function createEngine(spec: VideoSpec, root: HTMLElement): Promise<Engine> {
  await loadFonts();

  // No real-time clock anywhere: GSAP is only driven by seek().
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.sleep();

  const { width: W, height: H, fps } = spec;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  root.appendChild(out);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');

  const scene3 = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);

  const scenes: BuiltScene[] = spec.scenes.map((s) => {
    const inst = getTemplate(s.template).build({ scene: s, rng: mulberry32(s.seed) });
    inst.group.visible = false;
    scene3.add(inst.group);
    const move = cameraMoves[s.cameraMove];
    const cam = { ...move.initial };
    const tl = gsap.timeline({ paused: true });
    move.build(tl, cam, s.frameCount / fps);
    return { spec: s, inst, cam, tl };
  });

  let active = -1;
  const sceneIndexAt = (n: number) => {
    for (let i = scenes.length - 1; i >= 0; i--) if (n >= scenes[i].spec.startFrame) return i;
    return 0;
  };

  function renderFrame(n: number): void {
    if (!Number.isInteger(n) || n < 0 || n >= spec.totalFrames) {
      throw new RangeError(`Frame ${n} out of range 0..${spec.totalFrames - 1}`);
    }
    const i = sceneIndexAt(n);
    const s = scenes[i];
    if (i !== active) {
      if (active >= 0) scenes[active].inst.group.visible = false;
      s.inst.group.visible = true;
      scene3.background = new THREE.Color(s.inst.background);
      active = i;
    }
    const localFrame = n - s.spec.startFrame;
    const localSec = localFrame / fps;
    s.tl.seek(localSec, false);
    applyCamera(camera, s.cam);
    s.inst.update(localSec);
    renderer.render(scene3, camera);

    ctx!.globalAlpha = 1;
    ctx!.drawImage(renderer.domElement, 0, 0);
    const cue = s.spec.captions.find((c) => n >= c.startFrame && n < c.endFrame);
    if (cue) drawCaption(ctx!, cue, n, fps, spec.fontFamily, W, H);
    const dip = dipAlpha(localFrame, s.spec.frameCount, TRANSITION_FRAMES);
    if (dip > 0) {
      ctx!.fillStyle = `rgba(0, 0, 0, ${dip})`;
      ctx!.fillRect(0, 0, W, H);
    }
  }

  return {
    renderFrame,
    captureJpeg(quality) {
      return out.toDataURL('image/jpeg', quality).slice('data:image/jpeg;base64,'.length);
    },
    async captureRawHash() {
      const data = ctx.getImageData(0, 0, W, H).data;
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    },
    dispose() {
      for (const s of scenes) s.inst.dispose();
      renderer.dispose();
      out.remove();
    },
  };
}
```

- [ ] **Step 6: Page bridge** — `src/main.ts`

```ts
import type { VideoSpec } from '@cvs/shared';
import { createEngine, type Engine } from './engine';

declare global {
  interface Window {
    __engineReady: boolean;
    __engine: {
      init(spec: VideoSpec): Promise<true>;
      renderFrame(n: number): void;
      captureJpeg(quality: number): string;
      captureRawHash(): Promise<string>;
    };
  }
}

let engine: Engine | null = null;
const need = () => {
  if (!engine) throw new Error('Engine not initialised; call __engine.init(spec) first');
  return engine;
};

window.__engine = {
  async init(spec) {
    engine?.dispose();
    engine = await createEngine(spec, document.body);
    return true;
  },
  renderFrame: (n) => need().renderFrame(n),
  captureJpeg: (q) => need().captureJpeg(q),
  captureRawHash: () => need().captureRawHash(),
};
window.__engineReady = true;
```

- [ ] **Step 7: Build and typecheck**

Run: `npm run build:engine && npx tsc -p packages/scene-engine`
Expected: Vite prints `dist/index.html` and assets; `dist/` contains `Inter.ttf` and `NotoSansDevanagari.ttf`; tsc prints nothing.

- [ ] **Step 8: Commit**

```bash
git add packages/scene-engine
git commit -m "feat(engine): add deterministic Three.js/GSAP title-card engine with captions"
```

---

### Task 11: Engine browser tests (pixel determinism, Hindi shaping)

**Files:**
- Test: `packages/scene-engine/test/engine.browser.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CHROME_ARGS, buildVideoSpec, type VideoSpec } from '@cvs/shared';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4310;
let server: PreviewServer;
let browser: Browser;

beforeAll(async () => {
  await build({ root, logLevel: 'warn' });
  server = await preview({ root, preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
  browser = await puppeteer.launch({ headless: true, args: [...CHROME_ARGS] });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.httpServer.close(() => r()) : r()));
});

async function openEngine(spec: VideoSpec): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/engine/`);
  await page.waitForFunction('window.__engineReady === true');
  await page.evaluate((s) => window.__engine.init(s), spec);
  expect(errors).toEqual([]);
  return page;
}

const hashAt = (page: Page, n: number) =>
  page.evaluate(async (f) => {
    window.__engine.renderFrame(f);
    return window.__engine.captureRawHash();
  }, n);

describe('pixel determinism (raw canvas, before JPEG)', () => {
  const spec = buildVideoSpec({
    texts: ['Hello world. This is scene one.', 'Scene two has a few more words to show.'],
    audioSecs: [2.5, 2.5],
    lang: 'en-us',
  });

  it('same frame gives same pixels regardless of render order', async () => {
    const page = await openEngine(spec);
    const first = await hashAt(page, 45);
    for (let n = 0; n <= 120; n++) await page.evaluate((f) => window.__engine.renderFrame(f), n);
    expect(await hashAt(page, 45)).toBe(first);
    expect(await hashAt(page, 10)).not.toBe(first); // animation actually moves
    await page.close();
  });

  it('a fresh page with the same spec gives the same pixels', async () => {
    const a = await openEngine(spec);
    const b = await openEngine(spec);
    expect(await hashAt(b, 45)).toBe(await hashAt(a, 45));
    expect(await hashAt(b, 150)).toBe(await hashAt(a, 150));
    await a.close();
    await b.close();
  });

  it('does not leak memory across repeated full renders', async () => {
    const page = await openEngine(spec);
    const heapAfterPass = async () => {
      for (let n = 0; n < spec.totalFrames; n++) {
        await page.evaluate((f) => {
          window.__engine.renderFrame(f);
          window.__engine.captureJpeg(0.92);
        }, n);
      }
      const session = await page.createCDPSession();
      await session.send('HeapProfiler.collectGarbage');
      await session.detach();
      return (await page.metrics()).JSHeapUsedSize ?? 0;
    };
    const first = await heapAfterPass();
    await heapAfterPass();
    const third = await heapAfterPass();
    console.log(`[memory] JS heap after pass 1: ${(first / 2 ** 20).toFixed(1)} MB, pass 3: ${(third / 2 ** 20).toFixed(1)} MB`);
    expect(third - first).toBeLessThan(5 * 2 ** 20);
    await page.close();
  });
});

describe('Hindi captions', () => {
  const spec = buildVideoSpec({
    texts: ['नमस्ते दोस्तों। आज हम क्षत्रिय, ज्ञान और विज्ञान के बारे में जानेंगे।'],
    audioSecs: [4],
    lang: 'hi',
  });

  it('loads Noto Sans Devanagari', async () => {
    const page = await openEngine(spec);
    expect(await page.evaluate(() => document.fonts.check('600 40px "Noto Sans Devanagari"', 'क'))).toBe(true);
    await page.close();
  });

  it('shapes conjuncts (क्ष narrower than क + ् + ष measured apart)', async () => {
    const page = await openEngine(spec);
    const m = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '600 40px "Noto Sans Devanagari"';
      const w = (t: string) => ctx.measureText(t).width;
      return { conjunct: w('क्ष'), parts: w('क') + w('्') + w('ष') };
    });
    expect(m.conjunct).toBeLessThan(m.parts);
    await page.close();
  });

  it('writes a Hindi caption frame for visual review', async () => {
    const page = await openEngine(spec);
    const jpeg = await page.evaluate(() => {
      window.__engine.renderFrame(30);
      return window.__engine.captureJpeg(0.92);
    });
    const dir = fileURLToPath(new URL('../../../test-artifacts/', import.meta.url));
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}hindi-caption.jpg`, Buffer.from(jpeg, 'base64'));
    expect(jpeg.length).toBeGreaterThan(10_000);
    await page.close();
  });
});
```

Spec frames for the determinism spec: (2.5 + 0.6) × 30 = 93 per scene, total 186, so frames 45, 120 and 150 are valid.

Notes (found during execution): `afterAll` must resolve when `server` is undefined (otherwise a failed setup hangs 240 s). The memory test (added for laptop safety) renders the full clip three times, forces GC via CDP `HeapProfiler.collectGarbage`, and asserts JS heap growth < 5 MB. Measured on the dev laptop: heap 3.4 → 3.6 MB; a separate 44 s / 1320-frame probe peaked at ~626 MB total Chromium working set at ~99 ms/frame (SwiftShader, CPU only).

- [ ] **Step 2: Run**

Run: `npx vitest run --project @cvs/scene-engine`
Expected: all tests PASS (the first run takes up to a minute while Vite builds and Chromium starts).

If the determinism test fails, look for any `Math.random`, `Date`, `performance.now` or `requestAnimationFrame` in the render path, and check that `gsap.ticker.sleep()` runs before any timeline is created.

- [ ] **Step 3: Visual check**

Open `test-artifacts/hindi-caption.jpg`. Expected: a 3D background and a bottom-third caption "नमस्ते दोस्तों।" with correct conjuncts and matras, and no boxes (tofu).

- [ ] **Step 4: Commit**

```bash
git add packages/scene-engine/test
git commit -m "test(engine): verify raw-pixel determinism and Hindi caption shaping"
```

---

## Phase 4 — API: storage and media helpers

### Task 12: API package, ids and atomic job store

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/src/config.ts`, `src/ids.ts`, `src/atomicWrite.ts`, `src/jobStore.ts`
- Test: `apps/api/test/jobStore.test.ts`

- [ ] **Step 1: Package files**

`apps/api/package.json`:

```json
{
  "name": "@cvs/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "tsx src/server.ts", "start": "tsx src/server.ts" },
  "dependencies": {
    "@cvs/shared": "*",
    "cors": "^2.8.5",
    "express": "^5.1.0",
    "nanoid": "^5.1.0",
    "puppeteer": "^25.0.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/supertest": "^6.0.0",
    "supertest": "^7.0.0"
  }
}
```

(`nanoid` 5 is ESM and stable; 6 also works. `dev` deliberately does not use `tsx watch`, because restarts would interrupt renders.)

`apps/api/tsconfig.json`:

```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "lib": ["ES2023", "DOM"] }, "include": ["src", "test"] }
```

(`DOM` lib is needed only for the `window` typing used inside `page.evaluate` callbacks.)

`apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 60_000, fileParallelism: false },
});
```

`apps/api/src/config.ts`:

```ts
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const port = Number(process.env.API_PORT ?? 4000);

export const config = {
  port,
  ttsUrl: (process.env.TTS_URL ?? 'http://localhost:8001').replace(/\/$/, ''),
  dataDir: resolve(repoRoot, process.env.DATA_DIR ?? 'data'),
  jobsDir: join(resolve(repoRoot, process.env.DATA_DIR ?? 'data'), 'jobs'),
  musicDir: join(repoRoot, 'assets', 'music'),
  engineDist: join(repoRoot, 'packages', 'scene-engine', 'dist'),
  engineUrl: `http://localhost:${port}/engine/`,
  corsOrigins: [
    'http://localhost:5173',
    ...(process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  ],
};
```

`apps/api/src/ids.ts`:

```ts
import { nanoid } from 'nanoid';

export const JOB_ID_RE = /^[A-Za-z0-9_-]{21}$/;
export const newJobId = (): string => nanoid();
/** Must pass before any id touches the filesystem (prevents path traversal). */
export const isValidJobId = (id: string): boolean => JOB_ID_RE.test(id);
```

Run: `npm install`

- [ ] **Step 2: Write failing tests** — `apps/api/test/jobStore.test.ts`

```ts
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRequest } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isValidJobId } from '../src/ids';
import { JobStore } from '../src/jobStore';

const req: JobRequest = { script: 'Hi.', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false };
let dir: string;
let store: JobStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-store-'));
  store = new JobStore(dir);
  await store.init();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('ids', () => {
  it('accepts nanoid and rejects traversal', () => {
    expect(isValidJobId('V1StGXR8_Z5jdHi6B-myT')).toBe(true);
    expect(isValidJobId('../../etc/passwd')).toBe(false);
    expect(isValidJobId('short')).toBe(false);
  });
});

describe('JobStore', () => {
  it('creates a queued job and reads it back', async () => {
    const job = await store.create(req);
    expect(job.status).toBe('queued');
    expect(await store.get(job.id)).toEqual(job);
  });

  it('serialises concurrent updates without losing writes', async () => {
    const job = await store.create(req);
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.update(job.id, (j) => ({ ...j, warnings: [...j.warnings, `w${i}`] })),
      ),
    );
    const final = await store.get(job.id);
    expect(final!.warnings).toHaveLength(25);
    expect(new Set(final!.warnings).size).toBe(25);
  });

  it('leaves no temp files behind', async () => {
    const job = await store.create(req);
    await Promise.all(Array.from({ length: 10 }, () => store.update(job.id, (j) => ({ ...j, progress: j.progress + 1 }))));
    const files = await readdir(join(dir, job.id));
    expect(files).toEqual(['job.json']);
  });

  it('treats corrupt or missing job.json as no job and excludes it from list', async () => {
    const good = await store.create(req);
    const bad = 'A'.repeat(21);
    await mkdir(join(dir, bad));
    await writeFile(join(dir, bad, 'job.json'), '{not json');
    expect(await store.get(bad)).toBeNull();
    expect(await store.get('B'.repeat(21))).toBeNull();
    expect((await store.list()).map((j) => j.id)).toEqual([good.id]);
  });

  it('returns null for invalid ids instead of touching the filesystem', async () => {
    expect(await store.get('../x')).toBeNull();
    expect(() => store.dir('../x')).toThrow(/Invalid job id/);
  });

  it('lists newest first', async () => {
    const a = await store.create(req);
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.create(req);
    expect((await store.list()).map((j) => j.id)).toEqual([b.id, a.id]);
  });

  it('update rejects for unknown job', async () => {
    await expect(store.update('C'.repeat(21), (j) => j)).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run --project @cvs/api test/jobStore.test.ts`
Expected: FAIL — `../src/jobStore` not found.

- [ ] **Step 4: Implement** — `apps/api/src/atomicWrite.ts`

```ts
import { randomBytes } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const RETRY_DELAYS_MS = [20, 40, 80, 160, 320];
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Write to a temp file, fsync, then rename over the target. Retries Windows sharing violations. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const fh = await open(tmp, 'w');
  try {
    await fh.writeFile(data, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (RETRYABLE.has(code) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      await rm(tmp, { force: true });
      throw err;
    }
  }
}
```

`apps/api/src/jobStore.ts`:

```ts
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobRecord, JobRequest } from '@cvs/shared';
import { writeFileAtomic } from './atomicWrite';
import { isValidJobId, newJobId } from './ids';

/** File-backed job store. The API process is the only writer of job.json. */
export class JobStore {
  private chains = new Map<string, Promise<unknown>>();

  constructor(readonly jobsDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true });
  }

  dir(id: string): string {
    if (!isValidJobId(id)) throw new Error('Invalid job id');
    return join(this.jobsDir, id);
  }

  async create(request: JobRequest): Promise<JobRecord> {
    const id = newJobId();
    await mkdir(this.dir(id), { recursive: true });
    const job: JobRecord = {
      id,
      createdAt: new Date().toISOString(),
      request,
      status: 'queued',
      progress: 0,
      warnings: [],
    };
    await this.write(job);
    return job;
  }

  async get(id: string): Promise<JobRecord | null> {
    if (!isValidJobId(id)) return null;
    try {
      return JSON.parse(await readFile(join(this.dir(id), 'job.json'), 'utf8')) as JobRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[jobs] unreadable job.json for ${id}: ${(err as Error).message}`);
      }
      return null;
    }
  }

  /** Serialised read-modify-write per job. */
  update(id: string, fn: (job: JobRecord) => JobRecord): Promise<JobRecord> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        const current = await this.get(id);
        if (!current) throw new Error(`Job ${id} not found`);
        const updated = fn(structuredClone(current));
        await this.write(updated);
        return updated;
      });
    this.chains.set(id, next);
    void next
      .catch(() => undefined)
      .finally(() => {
        if (this.chains.get(id) === next) this.chains.delete(id);
      });
    return next;
  }

  async list(): Promise<JobRecord[]> {
    const entries = await readdir(this.jobsDir).catch(() => [] as string[]);
    const jobs = await Promise.all(entries.filter(isValidJobId).map((id) => this.get(id)));
    return jobs
      .filter((j): j is JobRecord => j !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private write(job: JobRecord): Promise<void> {
    return writeFileAtomic(join(this.dir(job.id), 'job.json'), JSON.stringify(job, null, 2));
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project @cvs/api test/jobStore.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api package-lock.json
git commit -m "feat(api): add job ids and atomic file-backed job store"
```

---

### Task 13: Process runner, FFmpeg helpers, BGM lookup (with real-FFmpeg audio tests)

**Files:**
- Create: `apps/api/src/proc.ts`, `src/ffmpeg.ts`, `src/bgm.ts`
- Test: `apps/api/test/ffmpeg.test.ts`, `apps/api/test/audio.integration.test.ts`, `apps/api/test/helpers/audio.ts`

- [ ] **Step 1: Write failing unit tests** — `apps/api/test/ffmpeg.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { buildEncodeArgs, buildMixArgs, buildNarrationArgs, checkVideo, type VideoInfo } from '../src/ffmpeg';

describe('buildNarrationArgs', () => {
  it('pads/trims each scene to an exact sample count and concatenates', () => {
    const args = buildNarrationArgs(['a.wav', 'b.wav'], [78, 30], 'out.wav');
    expect(args.slice(0, 7)).toEqual(['-y', '-v', 'error', '-i', 'a.wav', '-i', 'b.wav']);
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('[0:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_len=124800,atrim=end_sample=124800[s0]');
    expect(graph).toContain('apad=whole_len=48000,atrim=end_sample=48000[s1]');
    expect(graph).toContain('[s0][s1]concat=n=2:v=0:a=1[out]');
    expect(args.at(-1)).toBe('out.wav');
  });
});

describe('buildMixArgs', () => {
  it('loops BGM, lowers it, fades out and keeps narration length', () => {
    const args = buildMixArgs('n.wav', 'm.mp3', 40, 'mix.wav');
    expect(args).toContain('-stream_loop');
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect(graph).toContain('volume=0.12');
    expect(graph).toContain('atrim=duration=40.000000');
    expect(graph).toContain('afade=t=out:st=38.500000:d=1.5');
    expect(graph).toContain('[0:a][bg]amix=inputs=2:normalize=0:duration=first[out]');
  });
});

describe('buildEncodeArgs', () => {
  it('reads JPEG frames from stdin and encodes H.264/AAC with faststart', () => {
    const args = buildEncodeArgs('mix.wav', 'out.tmp.mp4');
    expect(args.join(' ')).toBe(
      '-y -v error -f image2pipe -framerate 30 -c:v mjpeg -i - -i mix.wav -map 0:v -map 1:a ' +
        '-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ac 2 ' +
        '-movflags +faststart out.tmp.mp4',
    );
  });
});

describe('checkVideo', () => {
  const good: VideoInfo = {
    video: { codec: 'h264', width: 1280, height: 720, fps: 30, frames: 900, durationSec: 30 },
    audio: { codec: 'aac', durationSec: 30.01 },
  };
  it('passes a correct file', () => {
    expect(checkVideo(good, 900)).toEqual([]);
  });
  it('reports every problem', () => {
    const bad: VideoInfo = {
      video: { codec: 'vp9', width: 640, height: 360, fps: 25, frames: 899, durationSec: 30 },
      audio: { codec: 'mp3', durationSec: 30.1 },
    };
    expect(checkVideo(bad, 900)).toHaveLength(6);
  });
  it('reports missing audio', () => {
    expect(checkVideo({ ...good, audio: null }, 900)).toContain('no audio stream');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/api test/ffmpeg.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/proc.ts`

```ts
import { spawn } from 'node:child_process';

export const tail = (s: string, n = 2048): string => (s.length > n ? s.slice(-n) : s);

/** Runs a command to completion. Rejects with the stderr tail on non-zero exit. */
export function runProcess(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr = tail(stderr + d, 16_384)));
    child.on('error', (err) => reject(new Error(`Failed to start ${cmd}: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited with code ${code}: ${tail(stderr)}`));
    });
  });
}
```

`apps/api/src/ffmpeg.ts`:

```ts
import { BGM_FADE_SEC, BGM_VOLUME, FPS, HEIGHT, SAMPLES_PER_FRAME, WIDTH } from '@cvs/shared';
import { runProcess } from './proc';

/** Exact WAV length from sample count (not the container/header estimate). */
export async function probeWavSec(file: string): Promise<number> {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=duration_ts,sample_rate,duration', '-of', 'json', file,
  ]);
  const s = JSON.parse(stdout).streams?.[0];
  if (!s) throw new Error(`No audio stream in ${file}`);
  if (s.duration_ts && s.sample_rate) return Number(s.duration_ts) / Number(s.sample_rate);
  return Number(s.duration);
}

/** Each scene → 48 kHz mono, padded/trimmed to exactly sceneFrames × 1600 samples, then concatenated. */
export function buildNarrationArgs(inputs: string[], sceneFrames: number[], out: string): string[] {
  const args = ['-y', '-v', 'error'];
  for (const f of inputs) args.push('-i', f);
  const parts = sceneFrames.map((frames, i) => {
    const n = frames * SAMPLES_PER_FRAME;
    return `[${i}:a]aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,apad=whole_len=${n},atrim=end_sample=${n}[s${i}]`;
  });
  const concat = `${sceneFrames.map((_, i) => `[s${i}]`).join('')}concat=n=${sceneFrames.length}:v=0:a=1[out]`;
  args.push('-filter_complex', [...parts, concat].join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', out);
  return args;
}

/** Narration at full volume, looped BGM at BGM_VOLUME with fade-out; output length = narration length. */
export function buildMixArgs(narration: string, bgm: string, durationSec: number, out: string): string[] {
  const d = durationSec.toFixed(6);
  const fadeStart = Math.max(0, durationSec - BGM_FADE_SEC).toFixed(6);
  const graph =
    `[1:a]aresample=48000,aformat=channel_layouts=mono,volume=${BGM_VOLUME},atrim=duration=${d},` +
    `afade=t=out:st=${fadeStart}:d=${BGM_FADE_SEC}[bg];` +
    `[0:a][bg]amix=inputs=2:normalize=0:duration=first[out]`;
  return [
    '-y', '-v', 'error', '-i', narration, '-stream_loop', '-1', '-i', bgm,
    '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', out,
  ];
}

export function buildEncodeArgs(audio: string, out: string): string[] {
  return [
    '-y', '-v', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-i', audio,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-movflags', '+faststart', out,
  ];
}

export interface VideoInfo {
  video: { codec: string; width: number; height: number; fps: number; frames: number; durationSec: number } | null;
  audio: { codec: string; durationSec: number } | null;
}

export async function probeVideo(file: string): Promise<VideoInfo> {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file,
  ]);
  const streams: Record<string, string>[] = JSON.parse(stdout).streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const a = streams.find((s) => s.codec_type === 'audio');
  const [num, den] = (v?.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    video: v
      ? {
          codec: v.codec_name,
          width: Number(v.width),
          height: Number(v.height),
          fps: num / den,
          frames: Number(v.nb_read_frames ?? v.nb_frames),
          durationSec: Number(v.duration),
        }
      : null,
    audio: a ? { codec: a.codec_name, durationSec: Number(a.duration) } : null,
  };
}

/** Returns a list of problems; empty means the MP4 meets the spec. */
export function checkVideo(info: VideoInfo, expectedFrames: number): string[] {
  const p: string[] = [];
  const { video: v, audio: a } = info;
  if (!v) return ['no video stream'];
  if (v.codec !== 'h264') p.push(`video codec ${v.codec} != h264`);
  if (v.width !== WIDTH || v.height !== HEIGHT) p.push(`size ${v.width}x${v.height} != ${WIDTH}x${HEIGHT}`);
  if (Math.abs(v.fps - FPS) > 0.01) p.push(`fps ${v.fps} != ${FPS}`);
  if (v.frames !== expectedFrames) p.push(`frames ${v.frames} != ${expectedFrames}`);
  if (!a) {
    p.push('no audio stream');
    return p;
  }
  if (a.codec !== 'aac') p.push(`audio codec ${a.codec} != aac`);
  const drift = Math.abs(a.durationSec - v.durationSec);
  if (drift >= 1 / FPS) p.push(`audio/video duration differ by ${(drift * 1000).toFixed(0)} ms`);
  return p;
}
```

`apps/api/src/bgm.ts`:

```ts
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
```

- [ ] **Step 4: Run unit tests**

Run: `npx vitest run --project @cvs/api test/ffmpeg.test.ts`
Expected: PASS. (The narration test uses 78 × 1600 = 124800 and 30 × 1600 = 48000.)

- [ ] **Step 5: Write real-FFmpeg integration tests**

`apps/api/test/helpers/audio.ts`:

```ts
import { runProcess } from '../../src/proc';

export async function makeSine(file: string, seconds: number, freq = 440, sampleRate = 24000): Promise<void> {
  await runProcess('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi',
    '-i', `sine=frequency=${freq}:sample_rate=${sampleRate}:duration=${seconds}`,
    '-ac', '1', '-c:a', 'pcm_s16le', file,
  ]);
}

export async function makeSilence(file: string, seconds: number): Promise<void> {
  await runProcess('ffmpeg', [
    '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
    '-t', String(seconds), '-c:a', 'pcm_s16le', file,
  ]);
}

export async function probeStream(
  file: string,
): Promise<{ sampleRate: number; channels: number; codec: string; samples: number }> {
  const { stdout } = await runProcess('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels,codec_name,duration_ts', '-of', 'json', file,
  ]);
  const s = JSON.parse(stdout).streams[0];
  return {
    sampleRate: Number(s.sample_rate),
    channels: Number(s.channels),
    codec: s.codec_name,
    samples: Number(s.duration_ts),
  };
}

export async function meanVolumeDb(file: string): Promise<number> {
  const { stderr } = await runProcess('ffmpeg', ['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  if (!m) throw new Error(`volumedetect output missing for ${file}`);
  return Number(m[1]);
}
```

`apps/api/test/audio.integration.test.ts`:

```ts
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTiming } from '@cvs/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findBgm } from '../src/bgm';
import { buildMixArgs, buildNarrationArgs, probeWavSec } from '../src/ffmpeg';
import { runProcess } from '../src/proc';
import { makeSilence, makeSine, meanVolumeDb, probeStream } from './helpers/audio';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-audio-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('narration timeline', () => {
  it('measures real WAV duration from samples', async () => {
    const f = join(dir, 'probe.wav');
    await makeSine(f, 1.234);
    expect(await probeWavSec(f)).toBeCloseTo(1.234, 3);
  });

  it('concatenated narration equals totalFrames / 30 within 1 ms', async () => {
    const lengths = [1.234, 2.5, 0.777];
    const files = await Promise.all(
      lengths.map(async (s, i) => {
        const f = join(dir, `scene_${i}.wav`);
        await makeSine(f, s, 300 + i * 100);
        return f;
      }),
    );
    const secs = await Promise.all(files.map(probeWavSec));
    const timing = buildTiming(secs);
    const out = join(dir, 'narration.wav');
    await runProcess('ffmpeg', buildNarrationArgs(files, timing.sceneFrames, out));
    expect(Math.abs((await probeWavSec(out)) - timing.totalFrames / 30)).toBeLessThan(0.001);
  });

  it('resamples 24 kHz Kokoro-style input to 48 kHz before frame-aligned padding (exact sample count)', async () => {
    const src = join(dir, 'kokoro24k.wav');
    await makeSine(src, 1.234, 440, 24000); // same format Kokoro emits: 24 kHz mono PCM16
    expect(await probeStream(src)).toMatchObject({ sampleRate: 24000, channels: 1 });
    const timing = buildTiming([await probeWavSec(src)]);
    const out = join(dir, 'narration48k.wav');
    await runProcess('ffmpeg', buildNarrationArgs([src], timing.sceneFrames, out));
    const info = await probeStream(out);
    expect(info).toMatchObject({ sampleRate: 48000, channels: 1, codec: 'pcm_s16le' });
    // ceil((1.234 + 0.6) * 30) = 56 frames × 1600 samples/frame
    expect(info.samples).toBe(56 * 1600);
    expect(info.samples).toBe(timing.totalFrames * 1600);
  });
});

describe('background music', () => {
  it('keeps narration at least 12 dB louder than BGM', async () => {
    const narration = join(dir, 'n.wav');
    await makeSine(narration, 6, 440, 48000);
    const bgm = join(dir, 'bgm.wav');
    await makeSine(bgm, 2, 220, 44100); // shorter than narration -> must loop
    const silent = join(dir, 'silent.wav');
    await makeSilence(silent, 6);

    const mixed = join(dir, 'mix.wav');
    await runProcess('ffmpeg', buildMixArgs(narration, bgm, 6, mixed));
    expect(await probeWavSec(mixed)).toBeCloseTo(6, 2);

    const bgmOnly = join(dir, 'bgm-only.wav');
    await runProcess('ffmpeg', buildMixArgs(silent, bgm, 6, bgmOnly));
    const diff = (await meanVolumeDb(narration)) - (await meanVolumeDb(bgmOnly));
    expect(diff).toBeGreaterThanOrEqual(12);
  });

  it('findBgm returns null for a missing or empty folder and picks the first file by name', async () => {
    expect(await findBgm(join(dir, 'nope'))).toBeNull();
    const music = join(dir, 'music');
    await mkdir(music);
    expect(await findBgm(music)).toBeNull();
    await writeFile(join(music, 'b.mp3'), '');
    await writeFile(join(music, 'a.ogg'), '');
    await writeFile(join(music, 'notes.txt'), '');
    expect(await findBgm(music)).toBe(join(music, 'a.ogg'));
  });
});
```

- [ ] **Step 6: Run integration tests**

Run: `npx vitest run --project @cvs/api test/audio.integration.test.ts`
Expected: PASS. If `apad=whole_len` errors, check `ffmpeg -h filter=apad` lists `whole_len` (FFmpeg ≥ 4.2).

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add sample-exact narration, BGM mix, encode args and output checks"
```

---

### Task 14: TTS client with retry

**Files:**
- Create: `apps/api/src/ttsClient.ts`
- Test: `apps/api/test/ttsClient.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PipelineError } from '@cvs/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TtsClient } from '../src/ttsClient';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

/** Starts a fake TTS that replies with the given statuses in order. */
async function fakeTts(statuses: number[]): Promise<{ url: string; calls: () => number }> {
  let n = 0;
  server = createServer((req, res) => {
    if (req.url === '/health') return void res.writeHead(200).end('{"ok":true}');
    const status = statuses[Math.min(n++, statuses.length - 1)];
    if (status === 200) {
      res.writeHead(200, { 'content-type': 'audio/wav', 'x-duration': '1.5000' }).end(Buffer.from('RIFFfake'));
    } else {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `status ${status}` }));
    }
  });
  await new Promise<void>((r) => server!.listen(0, r));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, calls: () => n };
}

const body = { text: 'hi', lang: 'en-us' as const, voice: 'af_heart', speed: 1 };

describe('TtsClient', () => {
  it('health is false when unreachable', async () => {
    expect(await new TtsClient('http://127.0.0.1:1').health()).toBe(false);
  });

  it('returns audio and header duration', async () => {
    const t = await fakeTts([200]);
    const r = await new TtsClient(t.url).synthesize(body, 1);
    expect(r.wav.toString()).toBe('RIFFfake');
    expect(r.headerSec).toBe(1.5);
  });

  it('fails immediately on 4xx with scene number', async () => {
    const t = await fakeTts([400]);
    await expect(new TtsClient(t.url).synthesize(body, 3)).rejects.toMatchObject({
      code: 'TTS_FAILED',
      message: 'Scene 3: status 400',
    });
    expect(t.calls()).toBe(1);
  });

  it('retries once on 5xx then succeeds', async () => {
    const t = await fakeTts([500, 200]);
    await new TtsClient(t.url).synthesize(body, 1);
    expect(t.calls()).toBe(2);
  });

  it('fails after the retry on repeated 5xx', async () => {
    const t = await fakeTts([500, 500]);
    const err = await new TtsClient(t.url).synthesize(body, 2).catch((e) => e);
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.message).toBe('Scene 2: status 500');
    expect(t.calls()).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/api test/ttsClient.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/ttsClient.ts`

```ts
import { PipelineError, errorMessage, type Lang, type VoicesByLang } from '@cvs/shared';

export interface SynthesizeRequest {
  text: string;
  lang: Lang;
  voice: string;
  speed: number;
}

export interface TtsLike {
  readonly baseUrl: string;
  health(): Promise<boolean>;
  voices(): Promise<VoicesByLang>;
  synthesize(req: SynthesizeRequest, sceneNo: number): Promise<{ wav: Buffer; headerSec: number }>;
}

export class TtsClient implements TtsLike {
  constructor(readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async voices(): Promise<VoicesByLang> {
    const r = await fetch(`${this.baseUrl}/voices`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`TTS /voices returned ${r.status}`);
    return (await r.json()) as VoicesByLang;
  }

  /** 4xx: fail now. 5xx/network: retry once, then fail. */
  async synthesize(req: SynthesizeRequest, sceneNo: number): Promise<{ wav: Buffer; headerSec: number }> {
    let lastMessage = 'unknown error';
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}/synthesize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        lastMessage = `TTS request failed (${errorMessage(err)})`;
        continue;
      }
      if (res.ok) {
        return { wav: Buffer.from(await res.arrayBuffer()), headerSec: Number(res.headers.get('x-duration')) };
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      lastMessage = body.error ?? `HTTP ${res.status}`;
      if (res.status < 500) break;
    }
    throw new PipelineError('TTS_FAILED', `Scene ${sceneNo}: ${lastMessage}`);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project @cvs/api test/ttsClient.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add TTS client with single retry on server errors"
```

---

## Phase 5 — API: rendering, pipeline, worker, runner

### Task 15: Puppeteer → FFmpeg renderer

**Files:**
- Create: `apps/api/src/render.ts`
- Test: `apps/api/test/render.integration.test.ts`

- [ ] **Step 1: Implement** — `apps/api/src/render.ts`

```ts
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { CHROME_ARGS, HEIGHT, PipelineError, WIDTH, errorMessage, type VideoSpec } from '@cvs/shared';
import puppeteer from 'puppeteer';
import { buildEncodeArgs } from './ffmpeg';
import { tail } from './proc';

export interface RenderOptions {
  engineUrl: string;
  spec: VideoSpec;
  audioFile: string;
  outFile: string;
  onProgress(frame: number): void;
  signal: AbortSignal;
}

type EngineWindow = Window & {
  __engineReady?: boolean;
  __engine: {
    init(spec: VideoSpec): Promise<true>;
    renderFrame(n: number): void;
    captureJpeg(q: number): string;
  };
};

export async function renderVideo(o: RenderOptions): Promise<void> {
  const browser = await puppeteer.launch({ headless: true, args: [...CHROME_ARGS] });
  let ff: ChildProcessByStdio<Writable, null, Readable> | undefined;
  const pageErrors: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') console.warn(`[engine console] ${m.text()}`);
    });
    await page.goto(o.engineUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as unknown as EngineWindow).__engineReady === true, { timeout: 15_000 });
    try {
      await page.evaluate((spec) => (window as unknown as EngineWindow).__engine.init(spec), o.spec);
    } catch (err) {
      throw new PipelineError('RENDER_FAILED', `Scene engine init failed: ${errorMessage(err)}`);
    }

    const proc = spawn('ffmpeg', buildEncodeArgs(o.audioFile, o.outFile), {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    ff = proc;
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr = tail(stderr + d)));
    proc.stdin.on('error', () => undefined); // EPIPE if ffmpeg dies; detected via exitCode below
    const exited = new Promise<number>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', (code) => resolve(code ?? -1));
    });

    for (let n = 0; n < o.spec.totalFrames; n++) {
      if (o.signal.aborted) throw new PipelineError('INTERRUPTED', 'Render aborted');
      if (pageErrors.length) throw new PipelineError('RENDER_FAILED', `Page error at frame ${n}: ${pageErrors[0]}`);
      if (proc.exitCode !== null) throw new PipelineError('ENCODE_FAILED', `ffmpeg exited early: ${stderr}`);
      const b64 = await page.evaluate((f) => {
        const e = (window as unknown as EngineWindow).__engine;
        e.renderFrame(f);
        return e.captureJpeg(0.92);
      }, n);
      if (!proc.stdin.write(Buffer.from(b64, 'base64'))) {
        await Promise.race([once(proc.stdin, 'drain'), exited]);
      }
      if (n % 10 === 0) o.onProgress(n);
    }
    proc.stdin.end();
    const code = await exited;
    if (code !== 0) throw new PipelineError('ENCODE_FAILED', `ffmpeg exited with code ${code}: ${stderr}`);
    o.onProgress(o.spec.totalFrames);
  } finally {
    if (ff && ff.exitCode === null) ff.kill('SIGKILL');
    await browser.close().catch(() => undefined);
  }
}
```

- [ ] **Step 2: Write an integration test** (builds the engine, serves it with Vite preview, renders a 2-second clip)

`apps/api/test/render.integration.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVideoSpec } from '@cvs/shared';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { checkVideo, probeVideo } from '../src/ffmpeg';
import { renderVideo } from '../src/render';
import { makeSilence } from './helpers/audio';

const engineRoot = fileURLToPath(new URL('../../../packages/scene-engine', import.meta.url));
let server: PreviewServer;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-render-'));
  // Own outDir: the scene-engine test project builds packages/scene-engine/dist in parallel.
  const outDir = join(dir, 'engine-dist');
  await build({ root: engineRoot, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
  server = await preview({
    root: engineRoot,
    build: { outDir },
    preview: { port: 4311, strictPort: true },
    logLevel: 'warn',
  });
}, 240_000);

afterAll(async () => {
  await new Promise<void>((r) => server?.httpServer.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

it('renders a spec into a valid MP4 with matching frame count', async () => {
  const spec = buildVideoSpec({ texts: ['Short test scene.'], audioSecs: [1.4], lang: 'en-us' });
  const audio = join(dir, 'a.wav');
  await makeSilence(audio, spec.totalFrames / 30);
  const out = join(dir, 'out.mp4');
  const progress: number[] = [];
  await renderVideo({
    engineUrl: 'http://localhost:4311/engine/',
    spec,
    audioFile: audio,
    outFile: out,
    onProgress: (f) => progress.push(f),
    signal: new AbortController().signal,
  });
  expect(checkVideo(await probeVideo(out), spec.totalFrames)).toEqual([]);
  expect(progress.at(-1)).toBe(spec.totalFrames);
}, 180_000);

it('aborts when the signal fires', async () => {
  const spec = buildVideoSpec({ texts: ['Abort me.'], audioSecs: [1.4], lang: 'en-us' });
  const audio = join(dir, 'b.wav');
  await makeSilence(audio, spec.totalFrames / 30);
  const ac = new AbortController();
  const p = renderVideo({
    engineUrl: 'http://localhost:4311/engine/',
    spec,
    audioFile: audio,
    outFile: join(dir, 'abort.mp4'),
    onProgress: (f) => f >= 10 && ac.abort(),
    signal: ac.signal,
  });
  await expect(p).rejects.toMatchObject({ code: 'INTERRUPTED' });
}, 180_000);
```

Add `vite` to `apps/api` devDependencies: `npm install -D vite@^8 -w @cvs/api`.

- [ ] **Step 3: Run**

Run: `npx vitest run --project @cvs/api test/render.integration.test.ts`
Expected: PASS. Spec = ceil(2.0 × 30) = 60 frames.

- [ ] **Step 4: Commit**

```bash
git add apps/api package-lock.json
git commit -m "feat(api): render engine frames through Puppeteer into FFmpeg"
```

---

### Task 16: Pipeline and worker entry

**Files:**
- Create: `apps/api/src/pipeline.ts`, `src/worker/messages.ts`, `src/worker/index.ts`
- Test: `apps/api/test/pipeline.test.ts`

- [ ] **Step 1: Write failing tests** (fake TTS + fake render injected; real FFmpeg for audio)

```ts
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRequest, VoicesByLang } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runPipeline, type PipelineDeps, type Reporter } from '../src/pipeline';
import type { TtsLike } from '../src/ttsClient';
import { makeSine } from './helpers/audio';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-pipe-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** Fake TTS producing a real WAV of `secPerScene` seconds. */
function fakeTts(secPerScene: number, healthy = true): TtsLike {
  return {
    baseUrl: 'http://fake',
    health: async () => healthy,
    voices: async () => ({}) as VoicesByLang,
    async synthesize(_req, sceneNo) {
      const f = join(dir, `src_${sceneNo}.wav`);
      await makeSine(f, secPerScene);
      return { wav: await readFile(f), headerSec: secPerScene };
    },
  };
}

function recorder(): Reporter & { stages: string[]; warnings: string[] } {
  const r = {
    stages: [] as string[],
    warnings: [] as string[],
    progress(stage: string) {
      if (r.stages.at(-1) !== stage) r.stages.push(stage);
    },
    warning(m: string) {
      r.warnings.push(m);
    },
  };
  return r;
}

const req = (over: Partial<JobRequest> = {}): JobRequest => ({
  script: 'Scene one.\n\nScene two.',
  lang: 'en-us',
  voice: 'af_heart',
  speed: 1,
  bgm: false,
  ...over,
});

function deps(tts: TtsLike, musicDir = join(dir, 'no-music')): PipelineDeps {
  return {
    tts,
    engineUrl: 'http://unused',
    musicDir,
    // Fake renderer: writes a file so the rename step works; output check is skipped via verifyOutput.
    render: async (o) => {
      o.onProgress(o.spec.totalFrames);
      await writeFile(o.outFile, 'mp4');
    },
    verifyOutput: async () => [],
  };
}

describe('runPipeline', () => {
  it('fails with TTS_UNAVAILABLE when the service is down', async () => {
    await expect(runPipeline(dir, req(), deps(fakeTts(1, false)), recorder(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'TTS_UNAVAILABLE' });
  });

  it('fails with DURATION_EXCEEDED before mixing or rendering', async () => {
    let rendered = false;
    const d = { ...deps(fakeTts(23)), render: async () => void (rendered = true) };
    await expect(runPipeline(dir, req(), d, recorder(), new AbortController().signal))
      .rejects.toMatchObject({ code: 'DURATION_EXCEEDED' });
    expect(rendered).toBe(false);
    expect((await readdir(dir)).includes('narration.wav')).toBe(false);
  });

  it('runs all stages, writes spec.json and out.mp4, warns on short video and missing BGM', async () => {
    const r = recorder();
    const result = await runPipeline(dir, req({ bgm: true }), deps(fakeTts(1.2)), r, new AbortController().signal);
    expect(r.stages).toEqual(['tts', 'audio', 'render']);
    expect(result.sceneCount).toBe(2);
    expect(result.durationSec).toBeCloseTo(2 * 54 / 30, 6); // ceil(1.8*30)=54 frames per scene
    expect(r.warnings.some((w) => w.includes('no file was found in assets/music'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('shorter than the 30–45 s target'))).toBe(true);
    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(['scene_0.wav', 'scene_1.wav', 'narration.wav', 'spec.json', 'out.mp4']));
    expect(files).not.toContain('out.tmp.mp4');
    const spec = JSON.parse(await readFile(join(dir, 'spec.json'), 'utf8'));
    expect(spec.totalFrames).toBe(108);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/api test/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/pipeline.ts`

```ts
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FPS,
  MIN_TARGET_SEC,
  PipelineError,
  assertWithinLimit,
  buildTiming,
  buildVideoSpec,
  errorMessage,
  splitScenes,
  type JobRequest,
  type JobStage,
} from '@cvs/shared';
import { BGM_MISSING_WARNING, findBgm } from './bgm';
import { buildMixArgs, buildNarrationArgs, checkVideo, probeVideo, probeWavSec } from './ffmpeg';
import { runProcess } from './proc';
import { renderVideo, type RenderOptions } from './render';
import type { TtsLike } from './ttsClient';

export interface Reporter {
  progress(stage: JobStage, progress: number): void;
  warning(message: string): void;
}

export interface PipelineDeps {
  tts: TtsLike;
  engineUrl: string;
  musicDir: string;
  render?: (o: RenderOptions) => Promise<void>;
  verifyOutput?: (file: string, expectedFrames: number) => Promise<string[]>;
}

export interface PipelineResult {
  durationSec: number;
  sceneCount: number;
}

const defaultVerify = async (file: string, frames: number) => checkVideo(await probeVideo(file), frames);

async function ffmpeg(args: string[], what: string): Promise<void> {
  try {
    await runProcess('ffmpeg', args);
  } catch (err) {
    throw new PipelineError('ENCODE_FAILED', `${what} failed: ${errorMessage(err)}`);
  }
}

export async function runPipeline(
  jobDir: string,
  req: JobRequest,
  deps: PipelineDeps,
  report: Reporter,
  signal: AbortSignal,
): Promise<PipelineResult> {
  const checkAbort = () => {
    if (signal.aborted) throw new PipelineError('INTERRUPTED', 'Job aborted');
  };
  const texts = splitScenes(req.script);

  if (!(await deps.tts.health())) {
    throw new PipelineError(
      'TTS_UNAVAILABLE',
      `TTS service not reachable at ${deps.tts.baseUrl}. Start it with \`npm run dev:tts\`.`,
    );
  }

  // 1. TTS (0–25 %)
  report.progress('tts', 0);
  const wavs: string[] = [];
  const audioSecs: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    checkAbort();
    const { wav, headerSec } = await deps.tts.synthesize(
      { text: texts[i], lang: req.lang, voice: req.voice, speed: req.speed },
      i + 1,
    );
    const file = join(jobDir, `scene_${i}.wav`);
    await writeFile(file, wav);
    const sec = await probeWavSec(file);
    if (Number.isFinite(headerSec) && Math.abs(sec - headerSec) > 0.05) {
      console.warn(`[pipeline] scene ${i + 1}: X-Duration ${headerSec}s vs measured ${sec.toFixed(4)}s`);
    }
    wavs.push(file);
    audioSecs.push(sec);
    report.progress('tts', (25 * (i + 1)) / texts.length);
  }

  // 2. Authoritative duration check, before any mixing/rendering.
  assertWithinLimit(buildTiming(audioSecs), req.lang);
  const spec = buildVideoSpec({ texts, audioSecs, lang: req.lang });
  const videoSec = spec.totalFrames / FPS;
  await writeFile(join(jobDir, 'spec.json'), JSON.stringify(spec, null, 2));

  // 3. Audio (25–30 %)
  checkAbort();
  report.progress('audio', 25);
  const narration = join(jobDir, 'narration.wav');
  await ffmpeg(buildNarrationArgs(wavs, spec.scenes.map((s) => s.frameCount), narration), 'Narration build');
  const narrationSec = await probeWavSec(narration);
  if (Math.abs(narrationSec - videoSec) > 0.001) {
    throw new PipelineError('ENCODE_FAILED', `Narration is ${narrationSec}s but video is ${videoSec}s`);
  }
  let audio = narration;
  if (req.bgm) {
    const bgm = await findBgm(deps.musicDir);
    if (!bgm) report.warning(BGM_MISSING_WARNING);
    else {
      audio = join(jobDir, 'mix.wav');
      await ffmpeg(buildMixArgs(narration, bgm, videoSec, audio), 'Background music mix');
    }
  }
  report.progress('audio', 30);

  // 4. Render + encode (30–100 %)
  checkAbort();
  const tmp = join(jobDir, 'out.tmp.mp4');
  await (deps.render ?? renderVideo)({
    engineUrl: deps.engineUrl,
    spec,
    audioFile: audio,
    outFile: tmp,
    signal,
    onProgress: (f) => report.progress('render', 30 + (70 * f) / spec.totalFrames),
  });
  const problems = await (deps.verifyOutput ?? defaultVerify)(tmp, spec.totalFrames);
  if (problems.length) throw new PipelineError('ENCODE_FAILED', `Output check failed: ${problems.join('; ')}`);
  await rename(tmp, join(jobDir, 'out.mp4'));

  if (videoSec < MIN_TARGET_SEC) {
    report.warning(`Video is ${videoSec.toFixed(1)} s, shorter than the 30–45 s target.`);
  }
  return { durationSec: videoSec, sceneCount: texts.length };
}
```

`apps/api/src/worker/messages.ts`:

```ts
import type { ErrorCode, JobRequest, JobStage } from '@cvs/shared';

export interface WorkerStart {
  type: 'start';
  jobId: string;
  jobDir: string;
  request: JobRequest;
  ttsUrl: string;
  engineUrl: string;
  musicDir: string;
}

export type WorkerMessage =
  | { type: 'progress'; stage: JobStage; progress: number }
  | { type: 'warning'; message: string }
  | { type: 'done'; result: { durationSec: number; sceneCount: number } }
  | { type: 'failed'; error: { code: ErrorCode; message: string } };
```

`apps/api/src/worker/index.ts`:

```ts
// Render worker: forked by LocalForkRunner, one process per job. Talks to the API only via IPC.
import { PipelineError, errorMessage } from '@cvs/shared';
import { runPipeline } from '../pipeline';
import { TtsClient } from '../ttsClient';
import type { WorkerMessage, WorkerStart } from './messages';

const controller = new AbortController();

// API died or closed the channel: stop work (render loop checks the signal), then force exit.
process.on('disconnect', () => {
  controller.abort();
  setTimeout(() => process.exit(1), 10_000).unref();
});

const send = (m: WorkerMessage) =>
  new Promise<void>((resolve) => {
    if (!process.connected || !process.send) return resolve();
    process.send(m, () => resolve());
  });

process.once('message', async (start: WorkerStart) => {
  let lastPct = -1;
  try {
    const result = await runPipeline(
      start.jobDir,
      start.request,
      { tts: new TtsClient(start.ttsUrl), engineUrl: start.engineUrl, musicDir: start.musicDir },
      {
        progress: (stage, p) => {
          const pct = Math.round(p);
          if (pct !== lastPct) {
            lastPct = pct;
            void send({ type: 'progress', stage, progress: pct });
          }
        },
        warning: (message) => void send({ type: 'warning', message }),
      },
      controller.signal,
    );
    await send({ type: 'done', result });
  } catch (err) {
    const error =
      err instanceof PipelineError
        ? { code: err.code, message: err.message }
        : { code: 'RENDER_FAILED' as const, message: errorMessage(err) };
    await send({ type: 'failed', error });
  } finally {
    if (process.connected) process.disconnect();
  }
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project @cvs/api test/pipeline.test.ts`
Expected: PASS. Check: 23 s per scene → ceil(23.6 × 30) = 708 frames × 2 = 1416 → 47.2 s > 45 → DURATION_EXCEEDED.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add render pipeline with post-TTS duration check and worker entry"
```

---

### Task 17: LocalForkRunner

**Files:**
- Create: `apps/api/src/runner.ts`
- Test: `apps/api/test/runner.test.ts`, `apps/api/test/fixtures/fakeWorker.mjs`

- [ ] **Step 1: Fake worker** — `apps/api/test/fixtures/fakeWorker.mjs`

```js
// Behaviour is chosen by the job script text: "ok", "fail", "crash" or "slow".
process.once('message', async (start) => {
  const mode = start.request.script;
  const send = (m) => new Promise((r) => process.send(m, r));
  await send({ type: 'progress', stage: 'tts', progress: 10 });
  await send({ type: 'warning', message: 'w1' });
  if (mode === 'crash') process.exit(3);
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 300));
  if (mode === 'fail') await send({ type: 'failed', error: { code: 'TTS_FAILED', message: 'Scene 1: boom' } });
  else await send({ type: 'done', result: { durationSec: 33, sceneCount: 3 } });
  process.disconnect();
});
```

- [ ] **Step 2: Write failing tests** — `apps/api/test/runner.test.ts`

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JobRecord, JobRequest } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobStore } from '../src/jobStore';
import { LocalForkRunner } from '../src/runner';

const workerPath = fileURLToPath(new URL('./fixtures/fakeWorker.mjs', import.meta.url));
const req = (script: string): JobRequest => ({ script, lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false });

let dir: string;
let store: JobStore;
let runner: LocalForkRunner;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-runner-'));
  store = new JobStore(dir);
  await store.init();
  runner = new LocalForkRunner(store, { workerPath, execArgv: [], ttsUrl: 'x', engineUrl: 'x', musicDir: 'x' });
});
afterEach(async () => {
  runner.stop();
  await rm(dir, { recursive: true, force: true });
});

async function waitFinished(id: string): Promise<JobRecord> {
  for (let i = 0; i < 200; i++) {
    const j = await store.get(id);
    if (j && (j.status === 'done' || j.status === 'failed') && runner.activeJobId() !== id) return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timeout');
}

describe('LocalForkRunner', () => {
  it('marks a job done with result, progress 100 and warnings', async () => {
    const job = await store.create(req('ok'));
    runner.enqueue(job.id);
    const j = await waitFinished(job.id);
    expect(j).toMatchObject({ status: 'done', progress: 100, warnings: ['w1'], result: { durationSec: 33, sceneCount: 3 } });
    expect(j.startedAt).toBeDefined();
    expect(j.finishedAt).toBeDefined();
  });

  it('records worker-reported failures', async () => {
    const job = await store.create(req('fail'));
    runner.enqueue(job.id);
    expect(await waitFinished(job.id)).toMatchObject({ status: 'failed', error: { code: 'TTS_FAILED', message: 'Scene 1: boom' } });
  });

  it('marks WORKER_CRASHED when the worker exits without reporting', async () => {
    const job = await store.create(req('crash'));
    runner.enqueue(job.id);
    const j = await waitFinished(job.id);
    expect(j.status).toBe('failed');
    expect(j.error?.code).toBe('WORKER_CRASHED');
    expect(j.error?.message).toMatch(/code 3/);
  });

  it('runs jobs one at a time in FIFO order', async () => {
    const a = await store.create(req('slow'));
    const b = await store.create(req('ok'));
    runner.enqueue(a.id);
    runner.enqueue(b.id);
    expect(runner.activeJobId()).toBe(a.id);
    const ja = await waitFinished(a.id);
    const jb = await waitFinished(b.id);
    expect(Date.parse(jb.startedAt!)).toBeGreaterThanOrEqual(Date.parse(ja.finishedAt!));
  });

  it('ignores duplicate enqueues and non-queued jobs', async () => {
    const job = await store.create(req('ok'));
    await store.update(job.id, (j) => ({ ...j, status: 'done' }));
    runner.enqueue(job.id);
    runner.enqueue(job.id);
    await new Promise((r) => setTimeout(r, 100));
    expect(runner.activeJobId()).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run --project @cvs/api test/runner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — `apps/api/src/runner.ts`

```ts
import { fork, type ChildProcess } from 'node:child_process';
import type { JobRecord } from '@cvs/shared';
import type { JobStore } from './jobStore';
import { tail } from './proc';
import type { WorkerMessage, WorkerStart } from './worker/messages';

export interface JobRunner {
  enqueue(id: string): void;
  activeJobId(): string | null;
  stop(): void;
}

export interface LocalForkRunnerOptions {
  workerPath: string;
  execArgv: string[];
  ttsUrl: string;
  engineUrl: string;
  musicDir: string;
}

const now = () => new Date().toISOString();

/** In-memory FIFO, concurrency 1, one forked worker process per job. */
export class LocalForkRunner implements JobRunner {
  private queue: string[] = [];
  private active: { id: string; child?: ChildProcess } | null = null;

  constructor(
    private store: JobStore,
    private opts: LocalForkRunnerOptions,
  ) {}

  enqueue(id: string): void {
    if (this.active?.id === id || this.queue.includes(id)) return;
    this.queue.push(id);
    this.pump();
  }

  activeJobId(): string | null {
    return this.active?.id ?? null;
  }

  stop(): void {
    this.queue = [];
    this.active?.child?.kill();
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const id = this.queue.shift()!;
    this.active = { id }; // claim synchronously so concurrent pumps cannot double-start
    this.start(id).catch((err) => {
      console.error(`[runner] failed to start job ${id}:`, err);
      this.release();
    });
  }

  private release(): void {
    this.active = null;
    this.pump();
  }

  private async start(id: string): Promise<void> {
    const job = await this.store.get(id);
    if (!job || job.status !== 'queued') return this.release();
    await this.store.update(id, (j) => ({ ...j, status: 'running', startedAt: now(), progress: 0 }));

    const child = fork(this.opts.workerPath, [], {
      execArgv: this.opts.execArgv,
      stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
    });
    this.active = { id, child };
    let stderr = '';
    child.stderr?.on('data', (d) => {
      process.stderr.write(d);
      stderr = tail(stderr + d);
    });

    let settled = false;
    const patch = (fn: (j: JobRecord) => JobRecord) =>
      this.store.update(id, fn).catch((err) => console.error(`[runner] job ${id} update failed:`, err));

    child.on('message', (m: WorkerMessage) => {
      switch (m.type) {
        case 'progress':
          void patch((j) => ({ ...j, stage: m.stage, progress: m.progress }));
          break;
        case 'warning':
          void patch((j) => ({ ...j, warnings: [...j.warnings, m.message] }));
          break;
        case 'done':
          settled = true;
          void patch((j) => ({ ...j, status: 'done', progress: 100, finishedAt: now(), result: m.result }));
          break;
        case 'failed':
          settled = true;
          void patch((j) => ({ ...j, status: 'failed', finishedAt: now(), error: m.error }));
          break;
      }
    });

    child.on('exit', (code, signal) => {
      const final = settled
        ? this.store.update(id, (j) => j) // wait for queued writes on this job to flush
        : this.store.update(id, (j) => ({
            ...j,
            status: 'failed',
            finishedAt: now(),
            error: {
              code: 'WORKER_CRASHED',
              message: `Worker exited with code ${code ?? signal} before finishing. ${stderr}`.trim(),
            },
          }));
      final.catch((err) => console.error(err)).finally(() => this.release());
    });

    const start: WorkerStart = {
      type: 'start',
      jobId: id,
      jobDir: this.store.dir(id),
      request: job.request,
      ttsUrl: this.opts.ttsUrl,
      engineUrl: this.opts.engineUrl,
      musicDir: this.opts.musicDir,
    };
    child.send(start);
  }
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run --project @cvs/api test/runner.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add LocalForkRunner with crash detection and FIFO concurrency 1"
```

---

### Task 18: Startup recovery and cleanup

**Files:**
- Create: `apps/api/src/recovery.ts`
- Test: `apps/api/test/recovery.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JobRecord, JobRequest } from '@cvs/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobStore } from '../src/jobStore';
import { cleanupJobs, recoverJobs } from '../src/recovery';

const req: JobRequest = { script: 'x', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false };
const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-18T12:00:00Z');
let dir: string;
let store: JobStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-rec-'));
  store = new JobStore(dir);
  await store.init();
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function job(patch: Partial<JobRecord>): Promise<JobRecord> {
  const j = await store.create(req);
  return store.update(j.id, (r) => ({ ...r, ...patch }));
}

describe('recoverJobs', () => {
  it('marks running jobs INTERRUPTED, deletes partial output, returns queued oldest first', async () => {
    const running = await job({ status: 'running' });
    await writeFile(join(store.dir(running.id), 'out.tmp.mp4'), 'partial');
    const q2 = await job({ status: 'queued', createdAt: '2026-11-18T10:00:02Z' });
    const q1 = await job({ status: 'queued', createdAt: '2026-11-18T10:00:01Z' });
    const done = await job({ status: 'done' });

    const r = await recoverJobs(store);
    expect(r.interrupted).toEqual([running.id]);
    expect(r.queued).toEqual([q1.id, q2.id]);
    const after = await store.get(running.id);
    expect(after).toMatchObject({ status: 'failed', error: { code: 'INTERRUPTED' } });
    expect(after!.finishedAt).toBeDefined();
    expect(await readdir(store.dir(running.id))).not.toContain('out.tmp.mp4');
    expect((await store.get(done.id))!.status).toBe('done');
  });
});

describe('cleanupJobs', () => {
  it('removes only finished jobs older than 24 h and never active/queued/running/invalid dirs', async () => {
    const oldDone = await job({ status: 'done', finishedAt: new Date(NOW - 25 * HOUR).toISOString() });
    const oldFailed = await job({ status: 'failed', finishedAt: new Date(NOW - 48 * HOUR).toISOString() });
    const recentDone = await job({ status: 'done', finishedAt: new Date(NOW - 23 * HOUR).toISOString() });
    const queued = await job({ status: 'queued', createdAt: new Date(NOW - 72 * HOUR).toISOString() });
    const running = await job({ status: 'running', startedAt: new Date(NOW - 72 * HOUR).toISOString() });
    const activeOld = await job({ status: 'done', finishedAt: new Date(NOW - 30 * HOUR).toISOString() });
    const invalid = 'Z'.repeat(21);
    await mkdir(join(dir, invalid));
    await writeFile(join(dir, invalid, 'job.json'), 'garbage');
    await mkdir(join(dir, 'not-a-job-dir'));

    const removed = await cleanupJobs(store, { now: NOW, maxAgeMs: 24 * HOUR, activeId: activeOld.id });
    expect(removed.sort()).toEqual([oldDone.id, oldFailed.id].sort());
    const left = await readdir(dir);
    for (const id of [recentDone.id, queued.id, running.id, activeOld.id, invalid, 'not-a-job-dir']) {
      expect(left).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/api test/recovery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/recovery.ts`

```ts
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidJobId } from './ids';
import type { JobStore } from './jobStore';

export const INTERRUPTED_MESSAGE =
  'Job was interrupted because the API or worker stopped. Please generate again.';

/** Run at startup before serving: fail interrupted jobs, return queued jobs (oldest first) to re-enqueue. */
export async function recoverJobs(store: JobStore): Promise<{ interrupted: string[]; queued: string[] }> {
  const jobs = await store.list();
  const interrupted: string[] = [];
  for (const j of jobs.filter((x) => x.status === 'running')) {
    await store.update(j.id, (r) => ({
      ...r,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: { code: 'INTERRUPTED', message: INTERRUPTED_MESSAGE },
    }));
    await rm(join(store.dir(j.id), 'out.tmp.mp4'), { force: true });
    interrupted.push(j.id);
  }
  const queued = jobs
    .filter((x) => x.status === 'queued')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((x) => x.id);
  return { interrupted, queued };
}

/** Deletes done/failed jobs finished more than maxAgeMs ago. Never touches active, queued, running or invalid dirs. */
export async function cleanupJobs(
  store: JobStore,
  opts: { now: number; maxAgeMs: number; activeId: string | null },
): Promise<string[]> {
  const removed: string[] = [];
  const entries = await readdir(store.jobsDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!isValidJobId(entry) || entry === opts.activeId) continue;
    const job = await store.get(entry);
    if (!job) continue; // invalid/corrupt: keep for manual inspection
    if (job.status !== 'done' && job.status !== 'failed') continue;
    if (!job.finishedAt) continue;
    if (opts.now - Date.parse(job.finishedAt) <= opts.maxAgeMs) continue;
    await rm(store.dir(entry), { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project @cvs/api test/recovery.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): add startup recovery for interrupted jobs and safe 24h cleanup"
```

---

### Task 19: HTTP routes, prerequisites and server entry

**Files:**
- Create: `apps/api/src/app.ts`, `src/prereqs.ts`, `src/server.ts`
- Test: `apps/api/test/app.test.ts`

- [ ] **Step 1: Write failing tests** — `apps/api/test/app.test.ts`

```ts
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoicesByLang } from '@cvs/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { JobStore } from '../src/jobStore';
import type { JobRunner } from '../src/runner';
import type { TtsLike } from '../src/ttsClient';

let dir: string;
let store: JobStore;
let enqueued: string[];
let ttsUp: boolean;
let app: ReturnType<typeof createApp>;

const voices: VoicesByLang = { 'en-us': ['af_heart'], 'en-gb': ['bf_emma'], hi: ['hf_alpha'] };
const body = { script: 'One.\n\nTwo.', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-app-'));
  store = new JobStore(join(dir, 'jobs'));
  await store.init();
  enqueued = [];
  ttsUp = true;
  const runner: JobRunner = { enqueue: (id) => void enqueued.push(id), activeJobId: () => null, stop: () => {} };
  const tts: TtsLike = {
    baseUrl: 'http://fake',
    health: async () => ttsUp,
    voices: async () => {
      if (!ttsUp) throw new Error('down');
      return voices;
    },
    synthesize: async () => {
      throw new Error('unused');
    },
  };
  await mkdir(join(dir, 'music'));
  await mkdir(join(dir, 'engine'));
  app = createApp({ store, runner, tts, musicDir: join(dir, 'music'), engineDist: join(dir, 'engine'), corsOrigins: ['http://localhost:5173'] });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('API', () => {
  it('GET /api/health reports TTS state', async () => {
    expect((await request(app).get('/api/health')).body).toEqual({ api: 'ok', tts: 'ok' });
    ttsUp = false;
    expect((await request(app).get('/api/health')).body).toEqual({ api: 'ok', tts: 'unreachable' });
  });

  it('GET /api/config reflects BGM availability', async () => {
    expect((await request(app).get('/api/config')).body).toMatchObject({ bgmAvailable: false, maxScenes: 12, maxDurationSec: 45 });
    await writeFile(join(dir, 'music', 'track.mp3'), '');
    expect((await request(app).get('/api/config')).body.bgmAvailable).toBe(true);
  });

  it('GET /api/voices proxies TTS or returns 503', async () => {
    expect((await request(app).get('/api/voices')).body).toEqual(voices);
    ttsUp = false;
    expect((await request(app).get('/api/voices')).status).toBe(503);
  });

  it('POST /api/jobs validates the body', async () => {
    const r = await request(app).post('/api/jobs').send({ ...body, speed: 9 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/speed/);
  });

  it('POST /api/jobs rejects 13 scenes synchronously', async () => {
    const script = Array.from({ length: 13 }, (_, i) => `S${i}.`).join('\n\n');
    const r = await request(app).post('/api/jobs').send({ ...body, script });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/maximum is 12/);
    expect(enqueued).toEqual([]);
  });

  it('POST /api/jobs creates and enqueues a job', async () => {
    const r = await request(app).post('/api/jobs').send(body);
    expect(r.status).toBe(202);
    expect(enqueued).toEqual([r.body.id]);
    const g = await request(app).get(`/api/jobs/${r.body.id}`);
    expect(g.body).toMatchObject({ id: r.body.id, status: 'queued' });
    expect((await request(app).get('/api/jobs')).body).toHaveLength(1);
  });

  it('GET unknown or malicious ids → 404', async () => {
    expect((await request(app).get(`/api/jobs/${'A'.repeat(21)}`)).status).toBe(404);
    expect((await request(app).get('/api/jobs/..%2F..%2Fetc')).status).toBe(404);
  });

  it('video: 404 until done, then streams with range and download support', async () => {
    const { body: created } = await request(app).post('/api/jobs').send(body);
    expect((await request(app).get(`/api/jobs/${created.id}/video`)).status).toBe(404);
    await writeFile(join(store.dir(created.id), 'out.mp4'), Buffer.alloc(1000, 1));
    await store.update(created.id, (j) => ({ ...j, status: 'done' }));

    const full = await request(app).get(`/api/jobs/${created.id}/video`);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');

    const ranged = await request(app).get(`/api/jobs/${created.id}/video`).set('Range', 'bytes=0-99');
    expect(ranged.status).toBe(206);
    expect(ranged.headers['content-length']).toBe('100');

    const dl = await request(app).get(`/api/jobs/${created.id}/video?download=1`);
    expect(dl.headers['content-disposition']).toBe(`attachment; filename="video-${created.id}.mp4"`);
  });

  it('CORS allows the dev web origin', async () => {
    const r = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project @cvs/api test/app.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `apps/api/src/app.ts`

```ts
import { join } from 'node:path';
import {
  JobRequestSchema,
  MAX_DURATION_SEC,
  MAX_SCENES,
  MIN_TARGET_SEC,
  SPEAKING_RATES,
  errorMessage,
  splitScenes,
  type ApiConfig,
  type HealthStatus,
} from '@cvs/shared';
import cors from 'cors';
import express from 'express';
import { findBgm } from './bgm';
import type { JobStore } from './jobStore';
import type { JobRunner } from './runner';
import type { TtsLike } from './ttsClient';

export interface AppDeps {
  store: JobStore;
  runner: JobRunner;
  tts: TtsLike;
  musicDir: string;
  engineDist: string;
  corsOrigins: string[];
}

export function createApp(d: AppDeps) {
  const app = express();
  app.use(cors({ origin: d.corsOrigins }));
  app.use(express.json({ limit: '100kb' }));
  app.use('/engine', express.static(d.engineDist));

  app.get('/api/health', async (_req, res) => {
    const body: HealthStatus = { api: 'ok', tts: (await d.tts.health()) ? 'ok' : 'unreachable' };
    res.json(body);
  });

  app.get('/api/config', async (_req, res) => {
    const body: ApiConfig = {
      bgmAvailable: (await findBgm(d.musicDir)) !== null,
      maxScenes: MAX_SCENES,
      maxDurationSec: MAX_DURATION_SEC,
      minTargetSec: MIN_TARGET_SEC,
      rates: SPEAKING_RATES,
    };
    res.json(body);
  });

  app.get('/api/voices', async (_req, res) => {
    try {
      res.json(await d.tts.voices());
    } catch {
      res.status(503).json({ error: 'TTS service unreachable. Start it with `npm run dev:tts`.' });
    }
  });

  app.post('/api/jobs', async (req, res) => {
    const parsed = JobRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      res.status(400).json({ error });
      return;
    }
    try {
      splitScenes(parsed.data.script);
    } catch (err) {
      res.status(400).json({ error: errorMessage(err) });
      return;
    }
    const job = await d.store.create(parsed.data);
    d.runner.enqueue(job.id);
    res.status(202).json({ id: job.id });
  });

  app.get('/api/jobs', async (_req, res) => {
    res.json((await d.store.list()).slice(0, 20));
  });

  app.get('/api/jobs/:id', async (req, res) => {
    const job = await d.store.get(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(job);
  });

  app.get('/api/jobs/:id/video', async (req, res) => {
    const job = await d.store.get(req.params.id);
    if (!job || job.status !== 'done') {
      res.status(404).json({ error: 'Video not available' });
      return;
    }
    if (req.query.download === '1') res.attachment(`video-${job.id}.mp4`);
    res.type('video/mp4');
    res.sendFile(join(d.store.dir(job.id), 'out.mp4'));
  });

  return app;
}
```

If the Content-Disposition test fails because Express emits `filename="…"` in a different form, compare against `res.attachment` output in the installed Express version and adjust the expectation, not the behaviour.

`apps/api/src/prereqs.ts`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { runProcess } from './proc';

/** Returns human-readable problems; empty = ready. */
export async function checkPrereqs(engineDist: string): Promise<string[]> {
  const problems: string[] = [];
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) problems.push(`Node ${process.versions.node} found; Node 20 or newer is required.`);
  for (const bin of ['ffmpeg', 'ffprobe']) {
    try {
      await runProcess(bin, ['-version']);
    } catch {
      problems.push(`${bin} not found on PATH. Install FFmpeg and make sure \`${bin} -version\` works.`);
    }
  }
  if (!existsSync(join(engineDist, 'index.html'))) {
    problems.push('Scene engine is not built. Run: npm run build:engine');
  }
  try {
    // Puppeteer 25+: executablePath() returns a Promise.
    if (!existsSync(await puppeteer.executablePath())) throw new Error();
  } catch {
    problems.push('Puppeteer Chromium is missing. Run: npx puppeteer browsers install chrome');
  }
  return problems;
}
```

`apps/api/src/server.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { errorMessage } from '@cvs/shared';
import { createApp } from './app';
import { config } from './config';
import { JobStore } from './jobStore';
import { checkPrereqs } from './prereqs';
import { cleanupJobs, recoverJobs } from './recovery';
import { LocalForkRunner } from './runner';
import { TtsClient } from './ttsClient';

const DAY_MS = 24 * 3_600_000;

async function main() {
  const problems = await checkPrereqs(config.engineDist);
  if (problems.length) {
    console.error(`Cannot start API:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }

  const store = new JobStore(config.jobsDir);
  await store.init();
  const tts = new TtsClient(config.ttsUrl);
  const runner = new LocalForkRunner(store, {
    workerPath: fileURLToPath(new URL('./worker/index.ts', import.meta.url)),
    execArgv: ['--import', 'tsx'],
    ttsUrl: config.ttsUrl,
    engineUrl: config.engineUrl,
    musicDir: config.musicDir,
  });

  // Recovery and cleanup happen before the server accepts requests.
  const { interrupted, queued } = await recoverJobs(store);
  if (interrupted.length) console.warn(`[startup] marked ${interrupted.length} interrupted job(s) as failed`);
  const sweep = () =>
    cleanupJobs(store, { now: Date.now(), maxAgeMs: DAY_MS, activeId: runner.activeJobId() })
      .then((r) => r.length && console.log(`[cleanup] removed ${r.length} old job(s)`))
      .catch((err) => console.error(`[cleanup] ${errorMessage(err)}`));
  await sweep();
  setInterval(sweep, 3_600_000).unref();

  const app = createApp({
    store,
    runner,
    tts,
    musicDir: config.musicDir,
    engineDist: config.engineDist,
    corsOrigins: config.corsOrigins,
  });
  app.listen(config.port, () => {
    console.log(`API on http://localhost:${config.port} (TTS ${config.ttsUrl})`);
    // Workers load the engine page from this server, so re-enqueue only after listening.
    for (const id of queued) runner.enqueue(id);
  });

  const shutdown = () => {
    runner.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Run all API tests**

Run: `npx vitest run --project @cvs/api`
Expected: PASS (every API test file).

- [ ] **Step 5: Start manually**

Run: `npm run build:engine && npm run dev:api`
Expected: `API on http://localhost:4000 (TTS http://localhost:8001)`. Then `curl -s localhost:4000/api/health` → `{"api":"ok","tts":"unreachable"}` while TTS is stopped. Stop the API.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc -p apps/api`
Expected: no errors.

```bash
git add apps/api
git commit -m "feat(api): add HTTP routes, prerequisite checks and server entry"
```

---

## Phase 6 — Frontend

### Task 20: Web scaffold and API client

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `vercel.json`, `src/main.tsx`, `src/index.css`, `src/api.ts`, `src/vite-env.d.ts`, `src/hooks/useJobPolling.ts`

- [ ] **Step 1: Package and config**

`apps/web/package.json`:

```json
{
  "name": "@cvs/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": {
    "@cvs/shared": "*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "vite": "^8.0.0"
  }
}
```

`apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2023", "DOM", "DOM.Iterable"], "jsx": "react-jsx", "types": ["vite/client"] },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [react(), tailwindcss()], server: { port: 5173, strictPort: true } });
```

`apps/web/vercel.json` (not deployed in MVP):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

`apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Creative Video Studio</title>
  </head>
  <body class="bg-slate-950 text-slate-100">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/index.css`:

```css
@import 'tailwindcss';
```

`apps/web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}
```

`apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 2: API client** — `apps/web/src/api.ts`

```ts
import type { ApiConfig, HealthStatus, JobRecord, JobRequest, VoicesByLang } from '@cvs/shared';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  health: () => json<HealthStatus>('/api/health'),
  config: () => json<ApiConfig>('/api/config'),
  voices: () => json<VoicesByLang>('/api/voices'),
  listJobs: () => json<JobRecord[]>('/api/jobs'),
  getJob: (id: string) => json<JobRecord>(`/api/jobs/${id}`),
  createJob: (req: JobRequest) =>
    json<{ id: string }>('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }),
  videoUrl: (id: string, download = false) => `${BASE}/api/jobs/${id}/video${download ? '?download=1' : ''}`,
};
```

- [ ] **Step 3: Polling hook** — `apps/web/src/hooks/useJobPolling.ts`

```ts
import type { JobRecord } from '@cvs/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';

const isActive = (j: JobRecord) => j.status === 'queued' || j.status === 'running';

/** Polls a job every 1 s while it is queued or running. */
export function useJobPolling(id: string | null): JobRecord | null {
  const [job, setJob] = useState<JobRecord | null>(null);
  useEffect(() => {
    setJob(null);
    if (!id) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const j = await api.getJob(id);
        if (cancelled) return;
        setJob(j);
        if (isActive(j)) timer = window.setTimeout(tick, 1000);
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id]);
  return job;
}
```

- [ ] **Step 4: Install**

Run: `npm install`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/web package-lock.json
git commit -m "chore(web): scaffold React + Tailwind app with API client and job polling"
```

---

### Task 21: Dashboard UI

**Files:**
- Create: `apps/web/src/components/ScriptForm.tsx`, `src/components/OutputPanel.tsx`, `src/components/RecentJobs.tsx`, `src/App.tsx`

- [ ] **Step 1: Script form** — `apps/web/src/components/ScriptForm.tsx`

```tsx
import {
  DEFAULT_VOICES,
  LANGS,
  LANG_LABELS,
  MAX_DURATION_SEC,
  MAX_SCENES,
  MIN_TARGET_SEC,
  estimateDurationSec,
  parseParagraphs,
  type ApiConfig,
  type JobRequest,
  type Lang,
  type VoicesByLang,
} from '@cvs/shared';
import { useEffect, useMemo, useState } from 'react';

interface Props {
  voices: VoicesByLang | null;
  config: ApiConfig | null;
  disabled: boolean;
  onSubmit(req: JobRequest): void;
}

const PLACEHOLDER = `Paste your script here.

Each paragraph becomes one scene. Separate scenes with a blank line.

Aim for 30–45 seconds of narration.`;

export function ScriptForm({ voices, config, disabled, onSubmit }: Props) {
  const [script, setScript] = useState('');
  const [lang, setLang] = useState<Lang>('en-us');
  const [voice, setVoice] = useState(DEFAULT_VOICES['en-us']);
  const [speed, setSpeed] = useState(1);
  const [bgm, setBgm] = useState(false);

  const langVoices = voices?.[lang] ?? [];
  useEffect(() => {
    if (langVoices.length && !langVoices.includes(voice)) {
      setVoice(langVoices.includes(DEFAULT_VOICES[lang]) ? DEFAULT_VOICES[lang] : langVoices[0]);
    }
  }, [lang, langVoices, voice]);

  const scenes = useMemo(() => parseParagraphs(script), [script]);
  const estimate = useMemo(() => estimateDurationSec(scenes, lang, speed), [scenes, lang, speed]);
  const tooMany = scenes.length > MAX_SCENES;
  const canSubmit = !disabled && scenes.length > 0 && !tooMany && langVoices.includes(voice);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit({ script, lang, voice, speed, bgm });
      }}
    >
      <div>
        <label htmlFor="script" className="mb-1 block text-sm font-medium text-slate-300">Script</label>
        <textarea
          id="script"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={14}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm leading-relaxed focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
          <span className="text-slate-400">
            {scenes.length} scene{scenes.length === 1 ? '' : 's'} · ≈ {estimate.toFixed(0)} s (estimate)
          </span>
          {tooMany && <span className="text-red-400">Too many scenes: maximum is {MAX_SCENES}.</span>}
          {!tooMany && estimate > MAX_DURATION_SEC && (
            <span className="text-amber-400">
              Likely over {MAX_DURATION_SEC} s; generation will fail if the narration is too long.
            </span>
          )}
          {scenes.length > 0 && estimate < MIN_TARGET_SEC && (
            <span className="text-slate-500">Shorter than the 30–45 s target.</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-300">Language</span>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2"
          >
            {LANGS.map((l) => (
              <option key={l} value={l}>{LANG_LABELS[l]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-300">Voice</span>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={!langVoices.length}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 p-2 disabled:opacity-50"
          >
            {langVoices.length === 0 && <option>Voices unavailable</option>}
            {langVoices.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 flex justify-between font-medium text-slate-300">
          <span>Speed</span>
          <span className="text-slate-400">{speed.toFixed(2)}×</span>
        </span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={bgm}
          disabled={!config?.bgmAvailable}
          onChange={(e) => setBgm(e.target.checked)}
          className="accent-indigo-500"
        />
        <span className={config?.bgmAvailable ? '' : 'text-slate-500'}>Background music</span>
        {!config?.bgmAvailable && (
          <span className="text-xs text-slate-500">(add an audio file to assets/music to enable)</span>
        )}
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {disabled ? 'Generating…' : 'Generate Video'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Output panel** — `apps/web/src/components/OutputPanel.tsx`

```tsx
import type { JobRecord, JobStage } from '@cvs/shared';
import { api } from '../api';

const STAGE_LABELS: Record<JobStage, string> = {
  tts: 'Generating voice',
  audio: 'Mixing audio',
  render: 'Rendering video',
};

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1 text-sm text-amber-300">
      {items.map((w, i) => (
        <li key={i}>⚠ {w}</li>
      ))}
    </ul>
  );
}

export function OutputPanel({ job, submitError }: { job: JobRecord | null; submitError: string | null }) {
  if (submitError) {
    return <div className="rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">{submitError}</div>;
  }
  if (!job) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">
        Your video will appear here.
      </div>
    );
  }
  if (job.status === 'queued' || job.status === 'running') {
    const label = job.status === 'queued' ? 'Queued' : job.stage ? STAGE_LABELS[job.stage] : 'Starting';
    return (
      <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-5">
        <div className="flex justify-between text-sm">
          <span>{label}…</span>
          <span className="text-slate-400">{job.progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.progress}%` }} />
        </div>
        <Warnings items={job.warnings} />
      </div>
    );
  }
  if (job.status === 'failed') {
    return (
      <div className="space-y-2 rounded-lg border border-red-800 bg-red-950/40 p-5">
        <div className="font-semibold text-red-300">Generation failed ({job.error?.code})</div>
        <p className="text-sm text-red-200">{job.error?.message}</p>
        <Warnings items={job.warnings} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <video key={job.id} src={api.videoUrl(job.id)} controls className="w-full rounded-lg bg-black" />
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {job.result?.durationSec.toFixed(1)} s · {job.result?.sceneCount} scenes
        </span>
        <a
          href={api.videoUrl(job.id, true)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
        >
          Download MP4
        </a>
      </div>
      <Warnings items={job.warnings} />
    </div>
  );
}
```

- [ ] **Step 3: Recent jobs** — `apps/web/src/components/RecentJobs.tsx`

```tsx
import type { JobRecord } from '@cvs/shared';
import { api } from '../api';

const STATUS_STYLE: Record<JobRecord['status'], string> = {
  queued: 'text-slate-400',
  running: 'text-indigo-300',
  done: 'text-emerald-400',
  failed: 'text-red-400',
};

export function RecentJobs({ jobs, onSelect }: { jobs: JobRecord[]; onSelect(id: string): void }) {
  if (!jobs.length) return <p className="text-sm text-slate-500">No videos yet.</p>;
  return (
    <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
      {jobs.map((j) => (
        <li key={j.id} className="flex items-center gap-4 px-4 py-3 text-sm">
          <span className={`w-16 font-medium ${STATUS_STYLE[j.status]}`}>{j.status}</span>
          <button onClick={() => onSelect(j.id)} className="flex-1 truncate text-left hover:text-indigo-300">
            {j.request.script.slice(0, 80)}
          </button>
          <span className="text-slate-500">{new Date(j.createdAt).toLocaleString()}</span>
          {j.status === 'done' && (
            <a href={api.videoUrl(j.id, true)} className="text-emerald-400 hover:underline">
              Download
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: App** — `apps/web/src/App.tsx`

```tsx
import { errorMessage, type ApiConfig, type HealthStatus, type JobRecord, type JobRequest, type VoicesByLang } from '@cvs/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { OutputPanel } from './components/OutputPanel';
import { RecentJobs } from './components/RecentJobs';
import { ScriptForm } from './components/ScriptForm';
import { useJobPolling } from './hooks/useJobPolling';

export default function App() {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [voices, setVoices] = useState<VoicesByLang | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const job = useJobPolling(jobId);

  const refreshJobs = useCallback(() => {
    api.listJobs().then(setJobs).catch(() => undefined);
  }, []);

  useEffect(() => {
    Promise.all([api.config(), api.health()])
      .then(([c, h]) => {
        setConfig(c);
        setHealth(h);
      })
      .catch((e) => setApiError(`API not reachable (${errorMessage(e)}). Start it with \`npm run dev:api\`.`));
    api.voices().then(setVoices).catch(() => setVoices(null));
    refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') refreshJobs();
  }, [job?.status, refreshJobs]);

  const busy = job?.status === 'queued' || job?.status === 'running';

  async function submit(req: JobRequest) {
    setSubmitError(null);
    try {
      const { id } = await api.createJob(req);
      setJobId(id);
      refreshJobs();
    } catch (e) {
      setSubmitError(errorMessage(e));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold">Creative Video Studio</h1>
        <p className="text-sm text-slate-400">Paste a script, pick a voice, generate a narrated 3D video.</p>
      </header>

      {apiError && <div className="rounded-lg bg-red-950/50 p-3 text-sm text-red-300">{apiError}</div>}
      {health?.tts === 'unreachable' && (
        <div className="rounded-lg bg-amber-950/50 p-3 text-sm text-amber-300">
          TTS service is not running. Start it with <code>npm run dev:tts</code>, then reload.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">New video</h2>
          <ScriptForm voices={voices} config={config} disabled={busy} onSubmit={submit} />
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Output</h2>
          <OutputPanel job={job} submitError={submitError} />
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent videos</h2>
        <RecentJobs jobs={jobs} onSelect={setJobId} />
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Build and typecheck**

Run: `npx tsc -p apps/web && npm run build -w @cvs/web`
Expected: no type errors; Vite writes `apps/web/dist`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): add dashboard with script form, progress, preview and download"
```

---

## Phase 7 — End-to-end verification and docs

### Task 22: Smoke tests (English, Hindi, too long)

**Files:**
- Create: `scripts/fixtures/en.txt`, `scripts/fixtures/hi.txt`, `scripts/fixtures/long.txt`, `scripts/smoke.ts`

- [ ] **Step 1: Fixtures**

`scripts/fixtures/en.txt` (≈ 95 words, estimate ≈ 36 s):

```
The night sky has fascinated people for thousands of years. Every culture looked up and told stories about the stars.

Our Sun is just one of about two hundred billion stars in the Milky Way. It looks special only because it is so close to us.

Light from the Sun takes about eight minutes to reach Earth. When you look at it, you are seeing the past.

So next time you see the stars, remember that you are looking back in time across the universe. Every point of light is a message from long ago.
```

`scripts/fixtures/hi.txt` (≈ 79 words, estimate ≈ 35 s):

```
रात का आसमान हज़ारों सालों से इंसानों को आकर्षित करता रहा है। हर सभ्यता ने तारों के बारे में अपनी कहानियाँ बनाई हैं।

हमारा सूर्य आकाशगंगा के लगभग दो सौ अरब तारों में से सिर्फ़ एक है।

सूर्य की रोशनी को पृथ्वी तक पहुँचने में लगभग आठ मिनट लगते हैं। जब आप उसे देखते हैं, तो आप अतीत को देख रहे होते हैं।

तो अगली बार जब आप तारे देखें, तो याद रखिए कि आप समय में पीछे देख रहे हैं।
```

`scripts/fixtures/long.txt`: the four English paragraphs of `en.txt` written twice (8 paragraphs, ≈ 190 words, ≈ 70 s).

- [ ] **Step 2: Smoke script** — `scripts/smoke.ts`

```ts
// Usage: tsx scripts/smoke.ts en|hi|long   (API, TTS must be running)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JobRecord, JobRequest, VideoSpec } from '@cvs/shared';
import { checkVideo, probeVideo } from '../apps/api/src/ffmpeg';

const mode = process.argv[2] as 'en' | 'hi' | 'long';
if (!['en', 'hi', 'long'].includes(mode)) throw new Error('usage: smoke.ts en|hi|long');
const API = process.env.API_URL ?? 'http://localhost:4000';
const DATA = process.env.DATA_DIR ?? 'data';

const script = await readFile(`scripts/fixtures/${mode}.txt`, 'utf8');
const req: JobRequest = {
  script,
  lang: mode === 'hi' ? 'hi' : 'en-us',
  voice: mode === 'hi' ? 'hf_alpha' : 'af_heart',
  speed: 1,
  bgm: false,
};

const t0 = Date.now();
const created = await fetch(`${API}/api/jobs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(req),
});
if (created.status !== 202) throw new Error(`POST failed: ${created.status} ${await created.text()}`);
const { id } = (await created.json()) as { id: string };
console.log(`[${mode}] job ${id}`);

let job: JobRecord;
for (;;) {
  job = (await (await fetch(`${API}/api/jobs/${id}`)).json()) as JobRecord;
  process.stdout.write(`\r[${mode}] ${job.status} ${job.stage ?? ''} ${job.progress}%     `);
  if (job.status === 'done' || job.status === 'failed') break;
  if (Date.now() - t0 > 10 * 60_000) throw new Error('timeout after 10 min');
  await new Promise((r) => setTimeout(r, 2000));
}
console.log();

if (mode === 'long') {
  if (job.status !== 'failed' || job.error?.code !== 'DURATION_EXCEEDED') {
    throw new Error(`expected DURATION_EXCEEDED, got ${job.status} ${job.error?.code}`);
  }
  console.log(`PASS [long] rejected: ${job.error.message}`);
  process.exit(0);
}

if (job.status !== 'done') throw new Error(`job failed: ${job.error?.code} ${job.error?.message}`);
const dir = join(DATA, 'jobs', id);
const spec = JSON.parse(await readFile(join(dir, 'spec.json'), 'utf8')) as VideoSpec;
const info = await probeVideo(join(dir, 'out.mp4'));
const problems = checkVideo(info, spec.totalFrames);
const dur = info.video?.durationSec ?? 0;
if (dur < 30 || dur > 45) problems.push(`duration ${dur.toFixed(2)} s outside 30–45 s`);
if (problems.length) throw new Error(`FAIL [${mode}]:\n - ${problems.join('\n - ')}`);
console.log(
  `PASS [${mode}] ${dur.toFixed(2)} s, ${info.video!.frames} frames, ` +
    `A/V drift ${(Math.abs(info.audio!.durationSec - dur) * 1000).toFixed(0)} ms, ` +
    `total time ${((Date.now() - t0) / 1000).toFixed(0)} s`,
);
```

- [ ] **Step 3: Run end to end**

Terminal 1: `npm run build:engine && npm run dev` (starts TTS, API and web).
Terminal 2:

```bash
npm run smoke:en
npm run smoke:hi
npm run smoke:long
```

Expected:
- `PASS [en] 3x.xx s, N frames, A/V drift <33 ms, total time …`
- `PASS [hi] …`
- `PASS [long] rejected: Narration produces a …`

Note the render times printed. If a fixture lands outside 30–45 s because the real speaking rate differs, add or remove one sentence in the fixture (not in the code) and record the measured rate.

- [ ] **Step 4: Watch the outputs**

Open `data/jobs/<en-id>/out.mp4` and `data/jobs/<hi-id>/out.mp4`. Check by eye and ear: captions change in step with the narration; Hindi captions are shaped correctly; scene changes dip to black; nothing freezes.

- [ ] **Step 5: Commit**

```bash
git add scripts/fixtures scripts/smoke.ts
git commit -m "test: add English, Hindi and over-length end-to-end smoke tests"
```

---

### Task 23: UI walkthrough, README, final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Manual UI walkthrough** (with `npm run dev` running; open http://localhost:5173)

1. Paste `scripts/fixtures/en.txt`. Expect "4 scenes · ≈ 36 s (estimate)".
2. Switch language to Hindi. The voice list shows the four Hindi voices and defaults to `hf_alpha`.
3. Switch back to English (US), click **Generate Video**. The button disables, the progress bar moves through "Generating voice" → "Mixing audio" → "Rendering video".
4. When done, the video plays inline; **Download MP4** saves `video-<id>.mp4`.
5. Tick BGM with no file in `assets/music`: the toggle is disabled with a hint. Then add any `.mp3` to `assets/music`, reload, generate with BGM: the music is audible and quieter than the voice.
6. Paste `scripts/fixtures/long.txt` and generate. Expect the warning before generation and, after TTS, a failed card with `DURATION_EXCEEDED` and the shortening hint.
7. Stop the TTS service, reload: the amber banner appears. Restart it.
8. Crash recovery: start a render, kill the API (Ctrl+C) mid-render, restart it. That job shows `failed (INTERRUPTED)` and no `out.tmp.mp4` remains in its folder.

- [ ] **Step 2: README** — `README.md`

````markdown
# Creative Video Studio

Generate short narrated 3D videos (English or Hindi) from a pasted script.
Each paragraph becomes a scene: an animated Three.js/GSAP title card with timed captions,
narrated by Kokoro TTS, encoded to MP4 with FFmpeg.

## Requirements

- Node 20+
- FFmpeg and ffprobe on PATH
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for the TTS service automatically)

espeak-ng does not need to be installed; `kokoro-onnx` bundles it.

## Setup (once)

```bash
npm install           # also downloads Chromium for Puppeteer
npm run setup:tts     # Python env + Kokoro model (~350 MB)
npm run build:engine  # builds the scene engine page used by the renderer
```

## Run

```bash
npm run dev           # TTS :8001, API :4000, web :5173
```

Open http://localhost:5173, paste a script (blank line between scenes), choose language, voice
and speed, then click **Generate Video**.

Limits: up to 12 scenes; the final video must be 45 s or shorter (checked after voice generation).

Optional background music: put one `.mp3`, `.wav`, `.ogg` or `.m4a` file in `assets/music/`.

## Tests

```bash
npm test              # unit, integration and headless-browser tests
npm run test:tts      # TTS service tests (needs the model)
npm run smoke:en      # full English video (needs `npm run dev` running)
npm run smoke:hi      # full Hindi video
npm run smoke:long    # verifies over-length scripts are rejected
```

## Architecture

| Part | Path | Notes |
|---|---|---|
| Dashboard | `apps/web` | React + Tailwind; `VITE_API_URL` sets the API base |
| API + jobs | `apps/api` | Express; owns `data/jobs/<id>/job.json`; forks one worker per job |
| Render worker | `apps/api/src/worker` | TTS → sample-exact narration → Puppeteer frames → FFmpeg |
| Scene engine | `packages/scene-engine` | Deterministic Three.js + GSAP page, stepped frame by frame |
| Shared logic | `packages/shared` | Scene splitting, captions, timing, schemas |
| TTS | `services/tts` | FastAPI + kokoro-onnx (ONNX Runtime, no PyTorch) |

Design spec: `docs/superpowers/specs/2026-11-18-creative-video-studio-mvp-design.md`

## Deployment

The frontend has a minimal `apps/web/vercel.json` (root directory `apps/web`), but it is not
deployed yet. A deployed frontend needs a publicly reachable API, TTS and worker; that cloud
backend is planned for a later version.
````

- [ ] **Step 3: Full verification run**

```bash
npm test
npm run test:tts
npm run typecheck
```

Expected: all green, no type errors. Re-run `smoke:en` and `smoke:hi` if any code changed since Task 22.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, run, test and architecture"
```

---

## Spec coverage check

| Spec section | Task(s) |
|---|---|
| §3 layout, delete server.js | 1, 8, 12, 20 |
| §4 processes (worker fork, single writer) | 16, 17, 19 |
| §5 shared contracts | 2, 5 |
| §6 scene split, estimate, authoritative 45 s check | 3, 5, 16, 21 |
| §7 TTS service, model once, 400/500, retry | 6, 7, 14 |
| §8 real WAV duration, sample-exact padding, BGM rules | 13, 16 |
| §9 engine determinism, templates, camera, captions, fonts | 9, 10, 11 |
| §10 render/encode, backpressure, cleanup in finally | 15 |
| §11 atomic job.json, crash handling, recovery, cleanup | 12, 17, 18, 19 |
| §12 HTTP API, id validation, CORS, range | 19 |
| §13 frontend | 20, 21 |
| §14 scripts, env, prereqs, Vercel | 1, 19, 20, 23 |
| §15 tests (unit, audio, tts, engine pixels + Hindi, E2E en/hi/long) | 2–5, 7, 11, 13–19, 22 |
