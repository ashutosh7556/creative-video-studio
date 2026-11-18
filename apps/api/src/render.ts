import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { CHROME_ARGS, HEIGHT, PipelineError, WIDTH, errorMessage, type VideoSpec } from '@cvs/shared';
import puppeteer from 'puppeteer';
import { buildEncodeArgs } from './ffmpeg';
import { tail } from './proc';

export interface RenderOptions {
  engineUrl: string;
  spec: VideoSpec;
  audioFile: string;
  outFile: string;
  onProgress(frame: number): void;
  signal: AbortSignal;
  /** Reports spawned process ids (used by tests to verify cleanup). */
  onProcesses?(pids: { browserPid?: number; ffmpegPid?: number }): void;
}

type EngineWindow = Window & {
  __engineReady?: boolean;
  __engine: {
    init(spec: VideoSpec): Promise<true>;
    renderFrame(n: number): void;
    captureJpeg(q: number): string;
  };
};

/** Steps the scene engine frame by frame in headless Chromium and pipes JPEGs into FFmpeg. */
export async function renderVideo(o: RenderOptions): Promise<void> {
  const browser = await puppeteer.launch({ headless: true, args: [...CHROME_ARGS] });
  o.onProcesses?.({ browserPid: browser.process()?.pid });
  let ff: ChildProcessByStdio<Writable, null, Readable> | undefined;
  const pageErrors: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') console.warn(`[engine console] ${m.text()}`);
    });
    await page.goto(o.engineUrl, { waitUntil: 'load' });
    await page.waitForFunction(() => (window as unknown as EngineWindow).__engineReady === true, { timeout: 15_000 });
    try {
      await page.evaluate((spec) => (window as unknown as EngineWindow).__engine.init(spec), o.spec);
    } catch (err) {
      throw new PipelineError('RENDER_FAILED', `Scene engine init failed: ${errorMessage(err)}`);
    }

    const proc = spawn('ffmpeg', buildEncodeArgs(o.audioFile, o.outFile), {
      stdio: ['pipe', 'ignore', 'pipe'],
      windowsHide: true,
    });
    ff = proc;
    o.onProcesses?.({ ffmpegPid: proc.pid });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr = tail(stderr + d)));
    proc.stdin.on('error', () => undefined); // EPIPE if ffmpeg dies; detected via exitCode below
    const exited = new Promise<number>((resolve, reject) => {
      proc.on('error', reject);
      proc.on('close', (code) => resolve(code ?? -1));
    });

    for (let n = 0; n < o.spec.totalFrames; n++) {
      if (o.signal.aborted) throw new PipelineError('INTERRUPTED', 'Render aborted');
      if (pageErrors.length) throw new PipelineError('RENDER_FAILED', `Page error at frame ${n}: ${pageErrors[0]}`);
      if (proc.exitCode !== null) throw new PipelineError('ENCODE_FAILED', `ffmpeg exited early: ${stderr}`);
      const b64 = await page.evaluate((f) => {
        const e = (window as unknown as EngineWindow).__engine;
        e.renderFrame(f);
        return e.captureJpeg(0.92);
      }, n);
      if (!proc.stdin.write(Buffer.from(b64, 'base64'))) {
        await Promise.race([once(proc.stdin, 'drain'), exited]);
      }
      if (n % 10 === 0) o.onProgress(n);
    }
    proc.stdin.end();
    const code = await exited;
    if (code !== 0) throw new PipelineError('ENCODE_FAILED', `ffmpeg exited with code ${code}: ${stderr}`);
    o.onProgress(o.spec.totalFrames);
  } finally {
    if (ff && ff.exitCode === null) ff.kill('SIGKILL');
    await browser.close().catch(() => undefined);
  }
}
