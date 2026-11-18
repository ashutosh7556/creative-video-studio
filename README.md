# Creative Video Studio

Generate short narrated 3D videos (English or Hindi) from a pasted script.
Each paragraph becomes a scene: an animated Three.js/GSAP title card with timed captions,
narrated by Kokoro TTS and encoded to MP4 (1280×720, 30 fps, H.264/AAC) with FFmpeg.

## Requirements

- Node 20+
- FFmpeg and ffprobe on `PATH`
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for the TTS service automatically)

You don't need to install espeak-ng; `kokoro-onnx` bundles it.

## Setup (once)

```bash
npm install           # also downloads Chromium for Puppeteer
npm run setup:tts     # Python env + Kokoro model (~350 MB, verified by SHA-256)
npm run build:engine  # builds the scene engine page used by the renderer
```

## Login (required)

The dashboard and API only work for one email/password, which you set in a `.env` file at the repo root:

```bash
copy .env.example .env      # macOS/Linux: cp .env.example .env
```

Then edit `.env`:

```
AUTH_EMAIL=you@yourdomain.com
AUTH_PASSWORD=at-least-8-characters
AUTH_SECRET=            # optional; set a long random string to stay logged in across API restarts
```

- `.env` is gitignored, so your credentials are never committed. The API won't start without valid values.
- Sessions use an HttpOnly cookie that lasts 7 days.
- 5 wrong attempts from one IP lock login for 15 minutes.
- Change the password by editing `.env` and restarting the API.

## Run

```bash
npm run dev           # TTS :8001, API :4000, web :5173
```

Open http://localhost:5173, paste a script (put a blank line between scenes), choose the language, voice
and speed, then click **Generate Video**. When the video is ready it plays inline, and **Download MP4**
saves it.

- Up to 12 scenes. The final video must be 45 s or shorter. The UI shows an estimate, and the exact
  check runs after the voice is generated, before any rendering.
- Hindi voices: `hf_alpha`, `hf_beta`, `hm_omega`, `hm_psi`. English: all Kokoro US/UK voices.
- Optional background music: put one `.mp3`, `.wav`, `.ogg` or `.m4a` file in `assets/music/`
  (it isn't committed). It loops under the narration at about −18 dB and fades out at the end.
- Rendering runs one job at a time and takes about 2 minutes for a 30–45 s video on a laptop CPU.
  Peak Chromium memory is about 650 MB.

## Tests

```bash
npm test              # unit, integration, headless-browser and UI component tests
npm run test:tts      # TTS service tests (needs the model)
npm run typecheck

# End to end, with `npm run dev` (or at least TTS + API) running:
npm run smoke:en      # full English video, ffprobe-verified
npm run smoke:hi      # full Hindi video, ffprobe-verified
npm run smoke:long    # over-length script must be rejected with DURATION_EXCEEDED
```

## Architecture

| Part | Path | Notes |
|---|---|---|
| Dashboard | `apps/web` | React + Tailwind. `VITE_API_URL` sets the API base. |
| API + jobs | `apps/api` | Express. The only writer of `data/jobs/<id>/job.json` (atomic writes). Forks one worker per job. |
| Render worker | `apps/api/src/worker` | TTS → sample-exact 48 kHz narration → Puppeteer frames → FFmpeg. Talks to the API over IPC only. |
| Scene engine | `packages/scene-engine` | Deterministic Three.js + GSAP page, stepped frame by frame. Fonts are bundled (OFL). |
| Shared logic | `packages/shared` | Scene splitting, caption chunking, frame timing, schemas. |
| TTS | `services/tts` | FastAPI + kokoro-onnx (ONNX Runtime, no PyTorch). Model loads once at startup. |

Reliability:
- If the API stops mid-render, the worker stops Chromium and FFmpeg and exits.
- On the next start, interrupted jobs are marked `INTERRUPTED` and partial files are removed.
- Finished and failed jobs older than 24 h are cleaned up. Active jobs are never removed.

Docs:
- Design spec: `docs/superpowers/specs/2026-11-18-creative-video-studio-mvp-design.md`
- Implementation plan: `docs/superpowers/plans/2026-11-18-creative-video-studio-mvp.md`
- Dependency audit notes: `docs/dependency-audit.md`

## Deployment

The dashboard deploys to Vercel from the repo root (`vercel.json`): it builds only `apps/web`, skips
Puppeteer's Chromium download, and `.vercelignore` keeps `.env`, `data/` and the TTS model out of uploads.
In production the dashboard calls `/api/...` on its own domain. Until a backend (API + TTS + renderer) is
hosted and proxied there, the deployed site shows the login page but cannot sign in.
