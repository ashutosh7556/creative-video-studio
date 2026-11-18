import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoicesByLang } from '@cvs/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { JobStore } from '../src/jobStore';
import type { JobRunner } from '../src/runner';
import type { TtsLike } from '../src/ttsClient';

let dir: string;
let store: JobStore;
let enqueued: string[];
let ttsUp: boolean;
let app: ReturnType<typeof createApp>;
let agent: ReturnType<typeof request.agent>;
const AUTH = { email: 'owner@example.com', password: 'pw', secret: 'test-secret' };

const voices: VoicesByLang = { 'en-us': ['af_heart'], 'en-gb': ['bf_emma'], hi: ['hf_alpha'] };
const body = { script: 'One.\n\nTwo.', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-app-'));
  store = new JobStore(join(dir, 'jobs'));
  await store.init();
  enqueued = [];
  ttsUp = true;
  const runner: JobRunner = { enqueue: (id) => void enqueued.push(id), activeJobId: () => null, stop: () => {} };
  const tts: TtsLike = {
    baseUrl: 'http://fake',
    health: async () => ttsUp,
    voices: async () => {
      if (!ttsUp) throw new Error('down');
      return voices;
    },
    synthesize: async () => {
      throw new Error('unused');
    },
  };
  await mkdir(join(dir, 'music'));
  await mkdir(join(dir, 'engine'));
  await writeFile(join(dir, 'engine', 'index.html'), '<!doctype html><title>engine</title>');
  app = createApp({ store, runner, tts, musicDir: join(dir, 'music'), engineDist: join(dir, 'engine'), corsOrigins: ['http://localhost:5173'], auth: AUTH });
  agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: AUTH.email, password: AUTH.password }).expect(200);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('API', () => {
  it('GET /api/health reports TTS state', async () => {
    expect((await agent.get('/api/health')).body).toEqual({ api: 'ok', tts: 'ok' });
    ttsUp = false;
    expect((await agent.get('/api/health')).body).toEqual({ api: 'ok', tts: 'unreachable' });
  });

  it('GET /api/config reflects BGM availability', async () => {
    expect((await agent.get('/api/config')).body).toMatchObject({ bgmAvailable: false, maxScenes: 12, maxDurationSec: 45 });
    await writeFile(join(dir, 'music', 'track.mp3'), '');
    expect((await agent.get('/api/config')).body.bgmAvailable).toBe(true);
  });

  it('GET /api/voices proxies TTS or returns 503', async () => {
    expect((await agent.get('/api/voices')).body).toEqual(voices);
    ttsUp = false;
    expect((await agent.get('/api/voices')).status).toBe(503);
  });

  it('POST /api/jobs validates the body', async () => {
    const r = await agent.post('/api/jobs').send({ ...body, speed: 9 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/speed/);
  });

  it('POST /api/jobs rejects 13 scenes synchronously', async () => {
    const script = Array.from({ length: 13 }, (_, i) => `S${i}.`).join('\n\n');
    const r = await agent.post('/api/jobs').send({ ...body, script });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/maximum is 12/);
    expect(enqueued).toEqual([]);
  });

  it('POST /api/jobs creates and enqueues a job', async () => {
    const r = await agent.post('/api/jobs').send(body);
    expect(r.status).toBe(202);
    expect(enqueued).toEqual([r.body.id]);
    const g = await agent.get(`/api/jobs/${r.body.id}`);
    expect(g.body).toMatchObject({ id: r.body.id, status: 'queued' });
    expect((await agent.get('/api/jobs')).body).toHaveLength(1);
  });

  it('GET unknown or malicious ids → 404', async () => {
    expect((await agent.get(`/api/jobs/${'A'.repeat(21)}`)).status).toBe(404);
    expect((await agent.get('/api/jobs/..%2F..%2Fetc')).status).toBe(404);
    expect((await agent.get('/api/jobs/..%2F..%2Fetc/video')).status).toBe(404);
  });

  it('video: 404 until done, then streams with range and download support', async () => {
    const { body: created } = await agent.post('/api/jobs').send(body);
    expect((await agent.get(`/api/jobs/${created.id}/video`)).status).toBe(404);
    await writeFile(join(store.dir(created.id), 'out.mp4'), Buffer.alloc(1000, 1));
    await store.update(created.id, (j) => ({ ...j, status: 'done' }));

    const full = await agent.get(`/api/jobs/${created.id}/video`);
    expect(full.status).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');

    const ranged = await agent.get(`/api/jobs/${created.id}/video`).set('Range', 'bytes=0-99');
    expect(ranged.status).toBe(206);
    expect(ranged.headers['content-length']).toBe('100');

    const dl = await agent.get(`/api/jobs/${created.id}/video?download=1`);
    // Express 5 omits quotes for token-safe filenames (both forms are valid per RFC 6266).
    expect(dl.headers['content-disposition']).toMatch(new RegExp(`^attachment; filename="?video-${created.id}\\.mp4"?$`));
  });

  it('serves the built scene engine under /engine/', async () => {
    const r = await agent.get('/engine/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('<title>engine</title>');
  });

  it('CORS allows the dev web origin', async () => {
    const r = await agent.get('/api/health').set('Origin', 'http://localhost:5173');
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});
