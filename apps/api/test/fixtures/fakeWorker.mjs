// Behaviour is chosen by the job script text: "ok", "fail", "crash" or "slow".
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

process.once('message', async (start) => {
  const mode = start.request.script;
  const send = (m) => new Promise((r) => process.send(m, r));
  await send({ type: 'progress', stage: 'tts', progress: 10 });
  await send({ type: 'warning', message: 'w1' });
  if (mode === 'crash') {
    writeFileSync(join(start.jobDir, 'out.tmp.mp4'), 'partial'); // simulate a crash mid-encode
    process.exit(3);
  }
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 300));
  if (mode === 'fail') await send({ type: 'failed', error: { code: 'TTS_FAILED', message: 'Scene 1: boom' } });
  else await send({ type: 'done', result: { durationSec: 33, sceneCount: 3 } });
  process.disconnect();
});
