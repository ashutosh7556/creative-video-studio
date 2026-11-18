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
