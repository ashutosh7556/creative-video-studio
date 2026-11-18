// Render worker: forked by LocalForkRunner, one process per job.
// Talks to the API only via IPC and never writes job.json (the API is the single writer).
import { PipelineError, errorMessage } from '@cvs/shared';
import { runPipeline } from '../pipeline';
import { TtsClient } from '../ttsClient';
import type { WorkerMessage, WorkerStart } from './messages';

const controller = new AbortController();

// API died or closed the channel: stop work (render loop checks the signal and its
// finally-block closes Chromium and kills FFmpeg), then force exit as a backstop.
process.on('disconnect', () => {
  controller.abort();
  setTimeout(() => process.exit(1), 10_000).unref();
});

const send = (m: WorkerMessage) =>
  new Promise<void>((resolve) => {
    if (!process.connected || !process.send) return resolve();
    process.send(m, () => resolve());
  });

process.once('message', async (start: WorkerStart) => {
  let lastPct = -1;
  try {
    const result = await runPipeline(
      start.jobDir,
      start.request,
      { tts: new TtsClient(start.ttsUrl), engineUrl: start.engineUrl, musicDir: start.musicDir },
      {
        progress: (stage, p) => {
          const pct = Math.round(p);
          if (pct !== lastPct) {
            lastPct = pct;
            void send({ type: 'progress', stage, progress: pct });
          }
        },
        warning: (message) => void send({ type: 'warning', message }),
      },
      controller.signal,
    );
    await send({ type: 'done', result });
  } catch (err) {
    const error =
      err instanceof PipelineError
        ? { code: err.code, message: err.message }
        : { code: 'RENDER_FAILED' as const, message: errorMessage(err) };
    await send({ type: 'failed', error });
  } finally {
    if (process.connected) process.disconnect();
  }
});
