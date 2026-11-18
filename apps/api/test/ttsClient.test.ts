import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PipelineError } from '@cvs/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { TtsClient } from '../src/ttsClient';

let server: Server | undefined;
afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
});

type Reply = number | 'hang';

/** Starts a fake TTS. Each /synthesize call takes the next reply (the last one repeats). */
async function fakeTts(replies: Reply[], healthReply: Reply = 200): Promise<{ url: string; calls: () => number }> {
  let n = 0;
  server = createServer((req, res) => {
    if (req.url === '/health') {
      if (healthReply === 'hang') return; // never respond
      return void res.writeHead(healthReply).end('{"ok":true}');
    }
    const reply = replies[Math.min(n++, replies.length - 1)];
    if (reply === 'hang') return;
    if (reply === 200) {
      res.writeHead(200, { 'content-type': 'audio/wav', 'x-duration': '1.5000' }).end(Buffer.from('RIFFfake'));
    } else {
      res.writeHead(reply, { 'content-type': 'application/json' }).end(JSON.stringify({ error: `status ${reply}` }));
    }
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, calls: () => n };
}

/** A port with nothing listening (connection refused). */
async function closedPortUrl(): Promise<string> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return `http://127.0.0.1:${port}`;
}

const body = { text: 'hi', lang: 'en-us' as const, voice: 'af_heart', speed: 1 };

describe('TtsClient.health', () => {
  it('is true when /health responds 200', async () => {
    const t = await fakeTts([200]);
    expect(await new TtsClient(t.url).health()).toBe(true);
  });
  it('is false when unreachable', async () => {
    expect(await new TtsClient(await closedPortUrl()).health()).toBe(false);
  });
  it('is false (not hanging) when /health never answers', async () => {
    const t = await fakeTts([200], 'hang');
    const started = Date.now();
    expect(await new TtsClient(t.url, { healthTimeoutMs: 200 }).health()).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('TtsClient.synthesize', () => {
  it('returns audio and header duration', async () => {
    const t = await fakeTts([200]);
    const r = await new TtsClient(t.url).synthesize(body, 1);
    expect(r.wav.toString()).toBe('RIFFfake');
    expect(r.headerSec).toBe(1.5);
  });

  it('fails immediately on 4xx with scene number (no retry)', async () => {
    const t = await fakeTts([400]);
    await expect(new TtsClient(t.url).synthesize(body, 3)).rejects.toMatchObject({
      code: 'TTS_FAILED',
      message: 'Scene 3: status 400',
    });
    expect(t.calls()).toBe(1);
  });

  it('retries once on 5xx then succeeds', async () => {
    const t = await fakeTts([500, 200]);
    await new TtsClient(t.url).synthesize(body, 1);
    expect(t.calls()).toBe(2);
  });

  it('fails after the retry on persistent 5xx', async () => {
    const t = await fakeTts([500, 503]);
    const err = await new TtsClient(t.url).synthesize(body, 2).catch((e) => e);
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.message).toBe('Scene 2: status 503');
    expect(t.calls()).toBe(2);
  });

  it('retries a timed-out request once, then succeeds', async () => {
    const t = await fakeTts(['hang', 200]);
    const r = await new TtsClient(t.url, { requestTimeoutMs: 200 }).synthesize(body, 1);
    expect(r.headerSec).toBe(1.5);
    expect(t.calls()).toBe(2);
  });

  it('fails with a timeout message when the service keeps hanging', async () => {
    const t = await fakeTts(['hang']);
    const started = Date.now();
    const err = await new TtsClient(t.url, { requestTimeoutMs: 200 }).synthesize(body, 4).catch((e) => e);
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe('TTS_FAILED');
    expect(err.message).toBe('Scene 4: TTS request timed out after 200 ms');
    expect(t.calls()).toBe(2);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('fails after one retry when the service is down (connection refused)', async () => {
    const err = await new TtsClient(await closedPortUrl()).synthesize(body, 5).catch((e) => e);
    expect(err).toBeInstanceOf(PipelineError);
    expect(err.code).toBe('TTS_FAILED');
    expect(err.message).toMatch(/^Scene 5: TTS request failed \(/);
  });
});
