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
