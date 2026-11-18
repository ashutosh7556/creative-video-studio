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
