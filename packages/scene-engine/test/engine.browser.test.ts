import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CHROME_ARGS, buildVideoSpec, type VideoSpec } from '@cvs/shared';
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { build, preview, type PreviewServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4310;
let server: PreviewServer;
let browser: Browser;

beforeAll(async () => {
  await build({ root, logLevel: 'warn' });
  server = await preview({ root, preview: { port: PORT, strictPort: true }, logLevel: 'warn' });
  browser = await puppeteer.launch({ headless: true, args: [...CHROME_ARGS] });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((r) => (server ? server.httpServer.close(() => r()) : r()));
});

async function openEngine(spec: VideoSpec): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/engine/`);
  await page.waitForFunction('window.__engineReady === true');
  await page.evaluate((s) => window.__engine.init(s), spec);
  expect(errors).toEqual([]);
  return page;
}

const hashAt = (page: Page, n: number) =>
  page.evaluate(async (f) => {
    window.__engine.renderFrame(f);
    return window.__engine.captureRawHash();
  }, n);

describe('pixel determinism (raw canvas, before JPEG)', () => {
  const spec = buildVideoSpec({
    texts: ['Hello world. This is scene one.', 'Scene two has a few more words to show.'],
    audioSecs: [2.5, 2.5],
    lang: 'en-us',
  });

  it('same frame gives same pixels regardless of render order', async () => {
    const page = await openEngine(spec);
    const first = await hashAt(page, 45);
    for (let n = 0; n <= 120; n++) await page.evaluate((f) => window.__engine.renderFrame(f), n);
    expect(await hashAt(page, 45)).toBe(first);
    expect(await hashAt(page, 10)).not.toBe(first); // animation actually moves
    await page.close();
  });

  it('a fresh page with the same spec gives the same pixels', async () => {
    const a = await openEngine(spec);
    const b = await openEngine(spec);
    expect(await hashAt(b, 45)).toBe(await hashAt(a, 45));
    expect(await hashAt(b, 150)).toBe(await hashAt(a, 150));
    await a.close();
    await b.close();
  });

  it('does not leak memory across repeated full renders', async () => {
    const page = await openEngine(spec);
    const heapAfterPass = async () => {
      for (let n = 0; n < spec.totalFrames; n++) {
        await page.evaluate((f) => {
          window.__engine.renderFrame(f);
          window.__engine.captureJpeg(0.92);
        }, n);
      }
      const session = await page.createCDPSession();
      await session.send('HeapProfiler.collectGarbage');
      await session.detach();
      return (await page.metrics()).JSHeapUsedSize ?? 0;
    };
    const first = await heapAfterPass();
    await heapAfterPass();
    const third = await heapAfterPass();
    console.log(`[memory] JS heap after pass 1: ${(first / 2 ** 20).toFixed(1)} MB, pass 3: ${(third / 2 ** 20).toFixed(1)} MB`);
    expect(third - first).toBeLessThan(5 * 2 ** 20);
    await page.close();
  });
});

describe('Hindi captions', () => {
  const spec = buildVideoSpec({
    texts: ['नमस्ते दोस्तों। आज हम क्षत्रिय, ज्ञान और विज्ञान के बारे में जानेंगे।'],
    audioSecs: [4],
    lang: 'hi',
  });

  it('loads Noto Sans Devanagari', async () => {
    const page = await openEngine(spec);
    expect(await page.evaluate(() => document.fonts.check('600 40px "Noto Sans Devanagari"', 'क'))).toBe(true);
    await page.close();
  });

  it('shapes conjuncts (क्ष narrower than क + ् + ष measured apart)', async () => {
    const page = await openEngine(spec);
    const m = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = '600 40px "Noto Sans Devanagari"';
      const w = (t: string) => ctx.measureText(t).width;
      return { conjunct: w('क्ष'), parts: w('क') + w('्') + w('ष') };
    });
    expect(m.conjunct).toBeLessThan(m.parts);
    await page.close();
  });

  it('writes a Hindi caption frame for visual review', async () => {
    const page = await openEngine(spec);
    const jpeg = await page.evaluate(() => {
      window.__engine.renderFrame(30);
      return window.__engine.captureJpeg(0.92);
    });
    const dir = fileURLToPath(new URL('../../../test-artifacts/', import.meta.url));
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}hindi-caption.jpg`, Buffer.from(jpeg, 'base64'));
    expect(jpeg.length).toBeGreaterThan(10_000);
    await page.close();
  });
});
