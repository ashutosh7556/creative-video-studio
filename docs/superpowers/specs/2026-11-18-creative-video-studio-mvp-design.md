# Creative Video Studio — MVP Design

- **Date:** 2026-11-18
- **Status:** Approved (design review), pending spec review
- **Scope:** MVP — one complete, working 30–45 second narrated 3D video, generated from a pasted script, running locally.

## 1. Goal

A web dashboard where a user pastes a script, picks a language, voice and speed, clicks **Generate Video**, watches progress, previews the result and downloads an MP4. No code changes are needed between videos.

Each paragraph of the script becomes one scene. Each scene is an animated 3D title card (Three.js + GSAP) with a timed on-screen caption, narrated by Kokoro TTS (English or Hindi). FFmpeg combines frames, narration and optional background music into an H.264/AAC MP4.

### Success criteria

1. An English script and a Hindi script each produce a playable MP4: 1280×720, 30 fps, H.264 video, AAC audio, duration ≤ 45 s.
2. Narration and captions stay in sync for the whole video (audio/video stream durations differ by less than one frame, 33 ms).
3. Hindi captions render with correct Devanagari shaping (conjuncts, matras) using the bundled Noto Sans Devanagari font.
4. Scripts whose narrated video would exceed 45 s are rejected with a clear message before rendering starts.
5. Generating another video requires only the UI.

### Non-goals (MVP)

LLM topic-to-script, sound effects, per-scene language, live in-browser preview before rendering, authentication, cloud deployment of the backend, concurrent renders, keyword-driven 3D objects.

## 2. Verified technical facts

Verified by a spike on the development machine (Windows 11, 2026-11-18):

| Item | Result |
|---|---|
| `kokoro-onnx` 0.6.1, Python 3.12 via `uv`, ONNX Runtime 1.32 | Installs and runs; no PyTorch |
| espeak-ng | Bundled by `espeakng-loader` 0.2.4; no system install needed |
| Hindi voices in `voices-v1.0.bin` | `hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi` (upstream grade C) |
| Hindi G2P, `lang="hi"` | `नमस्ते दोस्तों…` → `nəmˈʌsteː dˈoːstõ…` |
| Output | 24 kHz mono float; 5.4 s of Hindi in 2.4 s on CPU |
| Model load | ~1.4 s warm, once per process |
| Unknown voice | `ValueError` |
| Unsupported language | `RuntimeError` |
| Windows console | IPA output needs `PYTHONIOENCODING=utf-8` |

Measured speaking rates at speed 1.0, used for frontend estimates: English ≈ 2.8 words/s, Hindi ≈ 2.4 words/s.

Model files:
- `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx` (~325 MB)
- `https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin` (~28 MB)

## 3. Repository layout

npm workspaces monorepo, TypeScript for all Node/browser code.

```
creative-video-studio/
├─ apps/
│  ├─ web/            React + Vite + TS + Tailwind dashboard (future Vercel target)
│  └─ api/            Express API, job store, job runner, render worker
├─ packages/
│  ├─ shared/         zod schemas, types, scene splitting, caption chunking, duration estimate
│  └─ scene-engine/   Three.js + GSAP runtime, built to a static page loaded by Puppeteer
├─ services/
│  └─ tts/            Python 3.12 (uv) FastAPI + kokoro-onnx
├─ assets/
│  ├─ fonts/          NotoSansDevanagari-*.ttf, Inter-*.ttf (OFL, committed)
│  └─ music/          optional user-supplied BGM (contents gitignored)
├─ scripts/           smoke tests (English, Hindi)
├─ data/jobs/<id>/    job working directories (gitignored)
└─ docs/
```

The existing empty, untracked `server.js` is deleted; `apps/api` replaces it.

## 4. Processes

| Process | Port | Responsibility |
|---|---|---|
| web | 5173 | UI only. Talks to API via `VITE_API_URL` (default `http://localhost:4000`). |
| api | 4000 | REST endpoints, job queue, **sole writer of `job.json`**, serves MP4s and the built scene-engine page, spawns workers. |
| render worker | — | Forked by api per job (`child_process.fork`). Runs the pipeline. Reports via IPC only. Concurrency 1. |
| tts | 8001 | Kokoro loaded once at startup. Stateless HTTP synthesis. |

The worker is a separate OS process so a crash in Puppeteer, Chromium or FFmpeg cannot take down the API, and so the runner can later be replaced by a queue-backed cloud worker without changing the pipeline code.

## 5. Shared contracts (`packages/shared`)

```ts
JobRequest = {
  script: string            // 1..6000 chars after trim
  lang: 'en-us' | 'en-gb' | 'hi'
  voice: string             // must belong to lang (validated by TTS too)
  speed: number             // 0.5..1.5
  bgm: boolean
}

JobStatus = 'queued' | 'running' | 'done' | 'failed'
JobStage  = 'tts' | 'audio' | 'render'

JobRecord = {
  id, createdAt, startedAt?, finishedAt?,
  request: JobRequest,
  status: JobStatus,
  stage?: JobStage,
  progress: number,          // 0..100 overall
  warnings: string[],
  error?: { code: ErrorCode, message: string },
  result?: { durationSec: number, sceneCount: number }
}

ErrorCode = 'SCRIPT_INVALID' | 'TTS_UNAVAILABLE' | 'TTS_FAILED' | 'DURATION_EXCEEDED'
          | 'RENDER_FAILED' | 'ENCODE_FAILED' | 'INTERRUPTED' | 'WORKER_CRASHED'

VideoSpec = {
  width: 1280, height: 720, fps: 30,
  totalFrames: number,
  lang, fontFamily,
  scenes: Array<{
    index, text,
    startFrame, frameCount,             // frame-aligned
    template: 'titleCard',
    cameraMove: 'dolly' | 'orbit' | 'pushIn',
    seed: number,
    captions: Array<{ text, startFrame, endFrame }>
  }>
}
```

Overall progress weights: TTS 0–25, audio 25–30, render/encode 30–100.

## 6. Script parsing and duration

### Scene splitting (`splitScenes`)
- Normalise line endings, split on one or more blank lines, trim, drop empty paragraphs.
- Collapse internal newlines inside a paragraph to spaces.
- Errors (`SCRIPT_INVALID`): zero scenes; more than 12 scenes.
- No character limit is used to control length. The 6000-character cap only guards against abuse.

### Frontend estimate (`estimateDurationSec`)
`sum over scenes( words / (rate[lang] * speed) + 0.6 )` with `rate = { 'en-us': 2.8, 'en-gb': 2.8, hi: 2.4 }`. Words are whitespace-separated tokens.

The UI shows the live scene count and estimated duration labelled "≈ estimate". It shows a warning above 45 s (generation still allowed, since the estimate may be wrong) and a note below 30 s.

### Authoritative duration check (worker, after TTS)
- Each scene's audio duration comes from the WAV itself (section 8), never only from the header.
- `sceneFrames = ceil((audioSec + 0.6) * 30)`, `totalFrames = Σ sceneFrames`, `videoSec = totalFrames / 30`.
- The 45 s limit applies to `videoSec` (narration plus padding), the length of the final video.
- If `videoSec > 45` the job fails with `DURATION_EXCEEDED` before audio mixing and rendering:
  *"Narration produces a 52.3 s video; the maximum is 45 s. Shorten the script by about 7.3 s (≈ 20 words)."*
- Videos under 30 s are allowed; the result shows an informational warning.

## 7. TTS service (`services/tts`)

FastAPI app. The Kokoro instance is created once in the lifespan handler and shared.

```
GET  /health      → { ok: true, model: "kokoro-v1.0" }
GET  /voices      → { "en-us": [...af_*, am_*], "en-gb": [...bf_*, bm_*], "hi": [hf_alpha, hf_beta, hm_omega, hm_psi] }
POST /synthesize  { text, lang, voice, speed } → audio/wav (PCM16, 24 kHz, mono), header X-Duration
```

- Voice lists are derived from `kokoro.get_voices()` by prefix (`a`→en-us, `b`→en-gb, `h`→hi). Other prefixes are ignored.
- Validation before inference returns 400 with a message: empty text, unknown voice, voice/lang mismatch, speed out of range. Language map: `en-us`→`en-us`, `en-gb`→`en-gb`, `hi`→`hi`.
- Inference runs under a `threading.Lock`, one request at a time, to avoid CPU thrash. Exceptions from inference return 500 with a message.
- `scripts/download_models.py` downloads both model files into `services/tts/models/` (gitignored), skips files that already exist with the expected size, and prints progress.
- Startup fails fast with a clear message if model files are missing.
- Run command sets `PYTHONIOENCODING=utf-8`.

### Worker TTS client
- Before the job starts: `GET /health`. If unreachable the job fails with `TTS_UNAVAILABLE`: "TTS service not reachable at http://localhost:8001. Start it with `npm run dev:tts`."
- Per scene: `POST /synthesize`, 60 s timeout. A 400 fails immediately with `TTS_FAILED` ("Scene 3: <message>"). A 5xx or network error is retried once, then fails.

## 8. Audio pipeline

1. Save each scene WAV as `scene_<i>.wav`.
2. **Measure the real duration**: `ffprobe -show_entries stream=duration_ts,sample_rate` → `samples / sampleRate`. Compare with `X-Duration`; log a warning if they differ by more than 50 ms. The ffprobe value is authoritative.
3. Compute frame-aligned scene timing (section 6). `sceneSec_i = sceneFrames_i / 30`.
4. Build `narration.wav` with one FFmpeg filter graph. Every scene is resampled to 48 kHz, padded to exactly `sceneSec_i` with `apad=whole_dur=<sceneSec_i>` and trimmed with `atrim=duration=<sceneSec_i>`, then everything is joined with the `concat` filter. Total samples = `Σ round(sceneSec_i * 48000)`, so the audio timeline matches the video frame timeline exactly.
5. Verify: ffprobe the duration of `narration.wav`. It must equal `totalFrames / 30` within 1 ms; otherwise fail `ENCODE_FAILED`.

### Background music (optional)
- BGM source: the first `.mp3`, `.wav`, `.ogg` or `.m4a` file in `assets/music/`, sorted by name.
- `GET /api/config` returns `{ bgmAvailable: boolean }`. The UI disables the BGM toggle with a hint when no file exists.
- If BGM is requested but no file exists at job time (for example, deleted meanwhile), the job continues without music and adds the warning: "Background music was enabled but no file was found in assets/music; the video was rendered without music."
- Mixing: BGM is looped (`-stream_loop -1`), trimmed to the video duration, volume `0.12` (≈ −18 dB), 1.5 s fade-out at the end. Narration volume stays at `1.0`. `amix=inputs=2:normalize=0:duration=first` with narration as the first input keeps the length tied to the narration.
- Output: `mix.wav` (or `narration.wav` when there is no BGM).

## 9. Scene engine (`packages/scene-engine`)

Built with Vite into a static page (`dist/index.html` plus assets, fonts copied in). The API serves it at `/engine/`. Puppeteer loads it from the API so fonts and assets resolve over HTTP.

### API (on `window.__engine`)
```ts
init(spec: VideoSpec): Promise<void>  // builds scenes, loads fonts, awaits document.fonts.ready
renderFrame(n: number): void          // deterministic; seeks master timeline to n / fps and renders
captureRaw(): Uint8ClampedArray       // composite canvas getImageData (used by tests)
captureJpeg(quality: number): string  // composite canvas → base64 JPEG
```

### Determinism rules
- No `requestAnimationFrame`, `Date.now()` or `performance.now()` in the render path. The GSAP master timeline is created `paused: true` and only driven with `seek()`. `gsap.ticker` is disabled (`gsap.ticker.lagSmoothing(0)`, `gsap.ticker.sleep()`).
- All randomness uses a seeded PRNG (mulberry32) keyed by `scene.seed`.
- Particle and shape motion are pure functions of time.
- `preserveDrawingBuffer: true` and `antialias: true` on the WebGL renderer.

### Rendering layers
1. **WebGL canvas** (Three.js): the current scene's 3D background.
2. **Composite 2D canvas** (1280×720): draws the WebGL canvas, then the caption.

### Template registry
```ts
interface SceneTemplate {
  id: string
  build(ctx: { scene, rng, three: THREE }): { group: THREE.Group, update(tSec: number): void, dispose(): void }
}
```
MVP ships `titleCard`: 5–8 floating low-poly shapes (icosahedron, torus, box, octahedron) with standard materials, a particle field (`THREE.Points`, ~400 points), one ambient, one key and one coloured rim light. The colour palette is chosen per scene from a fixed list by seed. Keyword-driven templates can be added later by registering another `SceneTemplate`; the engine does not change.

### Camera moves registry
`dolly` (z 12 → 8), `orbit` (±25° around the y axis), `pushIn` (slow FOV and z change). Each is a GSAP tween on the camera, placed on the master timeline at the scene's start time for its duration. Moves cycle by scene index. Scene transitions are a dip to black: the composite canvas fades out over the last 0.2 s of a scene and in over the first 0.2 s of the next (a black overlay whose alpha is a pure function of the frame number). Only one scene's 3D group is visible at any frame.

### Captions
- **Chunking** (`chunkCaption` in `packages/shared`, pure and unit-tested):
  1. Split the scene text into sentences at `. ! ? । ॥` (the delimiter stays with its sentence).
  2. Pack whole words into chunks of at most `maxChars` (en 70, hi 60). A sentence longer than the limit is split at word boundaries. Splitting happens only at whitespace, never inside a word, so Devanagari conjuncts and matras are never broken.
  3. Each chunk gets time in proportion to its character count within the scene's **audio** duration (excluding the 0.6 s tail pad), frame-aligned. The last chunk extends to the scene's end.
- **Rendering**: font size 40 px (Inter for English, Noto Sans Devanagari for Hindi, with Inter as fallback for Latin digits and punctuation). Wrapped to at most 2 lines by `measureText` against a 1100 px max width, centred in the bottom third on a rounded semi-opaque dark panel. Each chunk fades in over 0.2 s and slides up 12 px.
- **Fonts**: loaded with the `FontFace` API from bundled files. `init` awaits `document.fonts.ready` and asserts `document.fonts.check('40px "Noto Sans Devanagari"')`. If that fails, `init` rejects, so a job never renders with fallback glyphs.

## 10. Render and encode

The worker:

1. Launches Puppeteer's bundled Chromium in headless mode with `--use-angle=swiftshader --enable-unsafe-swiftshader --disable-gpu-sandbox`, viewport 1280×720, deviceScaleFactor 1.
2. Opens `http://localhost:4000/engine/`, collects `console` and `pageerror` messages, and calls `__engine.init(spec)`.
3. Spawns FFmpeg:
   ```
   ffmpeg -y -f image2pipe -framerate 30 -c:v mjpeg -i - -i <mix.wav>
          -map 0:v -map 1:a -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -r 30
          -c:a aac -b:a 192k -shortest -movflags +faststart out.tmp.mp4
   ```
4. For each frame: `renderFrame(n)` then `captureJpeg(0.92)`, decode the base64 and write it to FFmpeg stdin, respecting backpressure (wait for `drain`). Progress is reported over IPC every 10 frames.
5. Closes stdin and waits for FFmpeg to exit with code 0. On failure the last 2 KB of stderr goes into the error message.
6. Verifies `out.tmp.mp4` with ffprobe (section 13 checks), then renames it to `out.mp4`.
7. Always closes the browser and kills FFmpeg in a `finally` block.

A page error during render fails the job with `RENDER_FAILED`. Expected cost: about 1–3 minutes for 45 s on a typical laptop CPU (SwiftShader).

## 11. Job store, runner and reliability (`apps/api`)

### job.json
- Lives at `data/jobs/<id>/job.json`. The API is the only writer; the worker never writes it.
- **Atomic write**: write `job.json.<random>.tmp`, `fsync`, then `rename` over `job.json`. On Windows, `rename` can fail with `EPERM`/`EBUSY` while another handle reads the file, so it is retried up to 5 times with 20/40/80/160/320 ms backoff. Writes for one job are serialised through a per-job promise chain.
- Reads treat a missing or corrupt file as "not a job" and log it; such directories are never cleaned up automatically.

### Runner
- FIFO in-memory queue with concurrency 1. `POST /api/jobs` writes `job.json` with status `queued` and then enqueues.
- `JobRunner` interface: `enqueue(id)`, `cancelAll()`. The MVP implementation `LocalForkRunner` forks `worker.js` with the job id and passes `VideoSpec` building inputs over IPC.
- Worker → API IPC messages: `{ type: 'progress', stage, progress }`, `{ type: 'warning', message }`, `{ type: 'done', result }`, `{ type: 'failed', error }`.
- If the worker exits without sending `done` or `failed`, the job is marked `failed` / `WORKER_CRASHED` with the exit code and the stderr tail.
- If the worker sees the IPC channel disconnect (API died), it aborts: kills FFmpeg, closes the browser and exits. Orphan workers cannot keep running.

### Startup recovery
On API start, before accepting requests:
1. Scan `data/jobs/*/job.json`.
2. A `running` job is marked `failed` / `INTERRUPTED` ("Job was interrupted because the API or worker stopped. Please generate again."). Any leftover `out.tmp.mp4` is deleted.
3. `queued` jobs are re-enqueued in `createdAt` order.

### Cleanup
- Runs at startup (after recovery) and every hour.
- Deletes a job directory only when `status ∈ {done, failed}` and `finishedAt` is more than 24 h ago.
- Never deletes a directory whose job is `queued` or `running`, the job currently held by the runner, or a directory without a valid `job.json`.

## 12. HTTP API

```
GET  /api/health          → { api: 'ok', tts: 'ok' | 'unreachable' }
GET  /api/config          → { bgmAvailable, maxScenes: 12, maxDurationSec: 45, rates }
GET  /api/voices          → proxied from TTS /voices (503 if TTS is down)
POST /api/jobs            JobRequest → 202 { id }  |  400 { error }
GET  /api/jobs            → last 20 JobRecords, newest first
GET  /api/jobs/:id        → JobRecord  |  404
GET  /api/jobs/:id/video  → MP4 (HTTP range support); ?download=1 sets Content-Disposition: attachment; filename="video-<id>.mp4"
GET  /engine/*            → built scene-engine static files
```

- `POST /api/jobs` validates with zod and `splitScenes` (so 0 or more than 12 scenes is a synchronous 400). The duration check happens in the worker after TTS.
- CORS allows `http://localhost:5173` and the origins listed in the `CORS_ORIGINS` environment variable.
- Job ids are `nanoid` (21 chars, URL-safe). Ids are validated against `^[A-Za-z0-9_-]{21}$` before any filesystem access, which prevents path traversal.

## 13. Frontend (`apps/web`)

A single dashboard page built with Tailwind.

**Left panel: "New video"**
- Script textarea with a placeholder explaining that blank lines separate scenes.
- Live readout: `N scenes · ≈ 38 s`, with a warning or note per section 6 and an error if there are more than 12 scenes (the button is disabled).
- Language select (English US, English UK, Hindi) and a voice select filtered by language from `/api/voices`. Defaults: `af_heart` for en-us, `bf_emma` for en-gb, `hf_alpha` for hi. All Hindi voices are selectable.
- Speed slider from 0.5 to 1.5 in steps of 0.05, default 1.0.
- BGM toggle, disabled with a hint if `bgmAvailable` is false.
- **Generate Video** button, disabled while the current job is queued or running.
- A banner appears if `/api/health` reports the TTS service as unreachable.

**Right panel: "Output"**
- Progress card: stage label ("Generating voice", "Mixing audio", "Rendering video"), a progress bar, polled every 1 s while queued or running.
- On failure: the error message and code, plus warnings.
- On completion: a `<video controls>` element with `src=/api/jobs/:id/video`, duration and scene count, warnings, and a **Download MP4** button (`?download=1`).

**Below: "Recent videos"**
- The last 20 jobs with status, created time and a link to view or download.

## 14. Configuration and scripts

Root `package.json` scripts:
- `dev`: runs api, web and tts concurrently (`concurrently`).
- `dev:api`, `dev:web`, `dev:tts`.
- `build`: builds shared, scene-engine, api and web.
- `test`: Vitest across workspaces plus pytest for TTS.
- `setup:tts`: `uv sync` and model download.
- `smoke:en`, `smoke:hi`.

Environment variables (with defaults): `API_PORT=4000`, `TTS_URL=http://localhost:8001`, `DATA_DIR=./data`, `CORS_ORIGINS`, `VITE_API_URL=http://localhost:4000`.

Prerequisites, checked by the API at startup with a clear message on failure: Node ≥ 20, FFmpeg and ffprobe on `PATH`, `uv` installed, Puppeteer Chromium downloaded on `npm install`.

**Vercel**: a minimal `apps/web/vercel.json` (Vite build, SPA rewrite to `index.html`). It is not deployed in the MVP. The README notes that a deployed frontend needs a publicly reachable API.

## 15. Testing

| Layer | Tool | Tests |
|---|---|---|
| shared | Vitest | `splitScenes` (blank lines, CRLF, whitespace-only, 13 scenes → error); `chunkCaption` (sentence split incl. `।`, word-boundary packing, Hindi string never split mid-word, timing sums to scene audio, frame alignment); `estimateDurationSec`; zod schemas |
| api | Vitest | timing builder (frame alignment, `DURATION_EXCEEDED` message); FFmpeg argument builders (narration, BGM present and missing); atomic job store (concurrent writes, temp file cleanup, corrupt file handling); startup recovery (running → INTERRUPTED, queued re-enqueued); cleanup rules (active, recent and invalid kept, old done/failed removed); id validation |
| audio | Vitest + real FFmpeg | three synthetic sine WAVs of known length → `narration.wav` duration = `totalFrames / 30` ± 1 ms; BGM mix: narration mean volume at least 12 dB above BGM-only mean volume (`volumedetect`) |
| tts | pytest | `/voices` contains the 4 Hindi voices; mismatch (`hi` + `af_heart`) → 400; bad speed → 400; short English and Hindi synthesis → valid 24 kHz WAV with duration > 0; the model is loaded once (instance identity across requests) |
| engine | Vitest + Puppeteer, same headless Chromium flags as the worker | **Pixel determinism**: render frame 45, then frames 0..90, then frame 45 again; `captureRaw()` SHA-256 identical. A fresh page with the same spec gives the same hash for frame 45. **Hindi captions**: `document.fonts.check` is true for Noto Sans Devanagari; a shaping check shows the conjunct `क्ष` measures narrower than the sum of `क`, `्` and `ष` measured separately (proves complex-script shaping); a PNG of a Hindi caption frame is saved to `test-artifacts/` for visual review |
| E2E | `scripts/smoke.ts` | Run separately for English (`smoke:en`) and Hindi (`smoke:hi`): POST a 3–4 paragraph script, poll until done, then ffprobe `out.mp4`: H.264 1280×720, 30 fps, AAC; duration within 30–45 s; audio and video stream durations within 33 ms; frame count = `totalFrames`. A further case: a script that is too long → `DURATION_EXCEEDED` |

## 16. Extension seams (not built now)

| Seam | MVP | Later |
|---|---|---|
| Script source | Pasted script | LLM topic-to-script, which produces the same `JobRequest.script` |
| `SceneTemplate` registry | `titleCard` | Keyword-driven objects |
| `JobRunner` | `LocalForkRunner` | Redis/BullMQ plus cloud worker container |
| Storage | Local `data/jobs` | S3/R2 with signed URLs |
| TTS client | HTTP to localhost:8001 | Same HTTP contract against a hosted service |
| Captions | Proportional timing | Word-level timestamps if the TTS provides them |

## 17. Risks

| Risk | Mitigation |
|---|---|
| SwiftShader render speed | 720p, light geometry, about 400 particles; render time is measured in the smoke test |
| Hindi voice quality (grade C upstream) | Voice is selectable; the TTS contract allows swapping the provider |
| Caption timing is proportional, not word-accurate | Acceptable for MVP; chunks are short |
| Windows file-locking on rename | Retry with backoff; the API is the single writer |
| Large model download (~350 MB) | One-time `setup:tts` with progress and skip-if-present |
