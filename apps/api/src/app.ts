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

/** HTTP layer only: validates input, reads/creates jobs and enqueues them. Rendering happens in worker processes. */
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
