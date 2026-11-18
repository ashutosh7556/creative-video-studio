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
