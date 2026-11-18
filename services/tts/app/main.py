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
