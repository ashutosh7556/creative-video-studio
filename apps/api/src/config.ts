import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

const port = Number(process.env.API_PORT ?? 4000);

export const config = {
  port,
  ttsUrl: (process.env.TTS_URL ?? 'http://localhost:8001').replace(/\/$/, ''),
  dataDir: resolve(repoRoot, process.env.DATA_DIR ?? 'data'),
  jobsDir: join(resolve(repoRoot, process.env.DATA_DIR ?? 'data'), 'jobs'),
  musicDir: join(repoRoot, 'assets', 'music'),
  engineDist: join(repoRoot, 'packages', 'scene-engine', 'dist'),
  engineUrl: `http://localhost:${port}/engine/`,
  corsOrigins: [
    'http://localhost:5173',
    ...(process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  ],
};
