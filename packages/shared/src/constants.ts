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
