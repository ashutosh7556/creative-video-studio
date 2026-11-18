import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VoicesByLang } from '@cvs/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { JobStore } from '../src/jobStore';
import type { JobRunner } from '../src/runner';
import type { TtsLike } from '../src/ttsClient';

const AUTH = { email: 'owner@example.com', password: 'correct horse', secret: 'test-secret' };
let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cvs-auth-'));
  const store = new JobStore(join(dir, 'jobs'));
  await store.init();
  await mkdir(join(dir, 'engine'));
  await writeFile(join(dir, 'engine', 'index.html'), '<title>engine</title>');
  const runner: JobRunner = { enqueue: () => {}, activeJobId: () => null, stop: () => {} };
  const tts: TtsLike = {
    baseUrl: 'x',
    health: async () => true,
    voices: async () => ({}) as VoicesByLang,
    synthesize: async () => {
      throw new Error('unused');
    },
  };
  app = createApp({ store, runner, tts, musicDir: dir, engineDist: join(dir, 'engine'), corsOrigins: ['http://localhost:5173'], auth: AUTH });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('authentication', () => {
  it('blocks API routes without a session (401) but keeps health and the engine page public', async () => {
    for (const path of ['/api/jobs', '/api/config', '/api/voices', '/api/jobs/AAAAAAAAAAAAAAAAAAAAA/video']) {
      const r = await request(app).get(path);
      expect(r.status, path).toBe(401);
      expect(r.body.error).toBe('Login required');
    }
    expect((await request(app).post('/api/jobs').send({})).status).toBe(401);
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/engine/')).status).toBe(200);
  });

  it('rejects wrong credentials with 401 and no cookie', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: AUTH.email, password: 'nope' });
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('Invalid email or password');
    expect(r.headers['set-cookie']).toBeUndefined();
  });

  it('logs in, sets an HttpOnly SameSite=Lax cookie, and unlocks the API', async () => {
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/login').send({ email: AUTH.email, password: AUTH.password });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ authenticated: true, email: AUTH.email });
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/cvs_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect((await agent.get('/api/jobs')).status).toBe(200);
    expect((await agent.get('/api/auth/me')).body).toEqual({ authenticated: true, email: AUTH.email });
  });

  it('reports unauthenticated on /api/auth/me without a session', async () => {
    expect((await request(app).get('/api/auth/me')).body).toEqual({ authenticated: false });
  });

  it('logout clears the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: AUTH.email, password: AUTH.password });
    await agent.post('/api/auth/logout');
    expect((await agent.get('/api/jobs')).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const r = await request(app).get('/api/jobs').set('Cookie', 'cvs_session=99999999999999.forged');
    expect(r.status).toBe(401);
  });

  it('rate-limits after 5 failed attempts (429), even for the right password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/api/auth/login').send({ email: AUTH.email, password: 'bad' })).status).toBe(401);
    }
    const r = await request(app).post('/api/auth/login').send({ email: AUTH.email, password: AUTH.password });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/Too many failed attempts/);
  });

  it('allows credentialed CORS from the web origin', async () => {
    const r = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');
    expect(r.headers['access-control-allow-credentials']).toBe('true');
  });
});
