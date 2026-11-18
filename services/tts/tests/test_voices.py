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
