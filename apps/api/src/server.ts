import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMessage } from '@cvs/shared';
import { createApp } from './app';
import { loadAuthConfig } from './authConfig';
import { config, repoRoot } from './config';
import { JobStore } from './jobStore';
import { checkPrereqs } from './prereqs';
import { cleanupJobs, recoverJobs } from './recovery';
import { LocalForkRunner } from './runner';
import { TtsClient } from './ttsClient';

const DAY_MS = 24 * 3_600_000;

async function main() {
  // Login credentials live in <repo>/.env (gitignored). See .env.example.
  const envFile = join(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const authResult = loadAuthConfig(process.env);
  if (!authResult.ok) {
    console.error(`Cannot start API: ${authResult.error}`);
    process.exit(1);
  }

  const problems = await checkPrereqs(config.engineDist);
  if (problems.length) {
    console.error(`Cannot start API:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }

  const store = new JobStore(config.jobsDir);
  await store.init();
  const tts = new TtsClient(config.ttsUrl);
  const runner = new LocalForkRunner(store, {
    workerPath: fileURLToPath(new URL('./worker/index.ts', import.meta.url)),
    execArgv: ['--import', 'tsx'],
    ttsUrl: config.ttsUrl,
    engineUrl: config.engineUrl,
    musicDir: config.musicDir,
  });

  // Recovery and cleanup happen before the server accepts requests.
  const { interrupted, queued } = await recoverJobs(store);
  if (interrupted.length) console.warn(`[startup] marked ${interrupted.length} interrupted job(s) as failed`);
  const sweep = () =>
    cleanupJobs(store, { now: Date.now(), maxAgeMs: DAY_MS, activeId: runner.activeJobId() })
      .then((r) => r.length && console.log(`[cleanup] removed ${r.length} old job(s)`))
      .catch((err) => console.error(`[cleanup] ${errorMessage(err)}`));
  await sweep();
  setInterval(sweep, 3_600_000).unref();

  const app = createApp({
    store,
    runner,
    tts,
    musicDir: config.musicDir,
    engineDist: config.engineDist,
    corsOrigins: config.corsOrigins,
    auth: authResult.auth,
  });
  app.listen(config.port, () => {
    console.log(`API on http://localhost:${config.port} (TTS ${config.ttsUrl})`);
    // Workers load the engine page from this server, so re-enqueue only after listening.
    for (const id of queued) runner.enqueue(id);
  });

  const shutdown = () => {
    runner.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
