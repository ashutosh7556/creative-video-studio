import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, api } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('api client', () => {
  it('defaults to the local API and builds video URLs', () => {
    expect(api.videoUrl('abc')).toBe('http://localhost:4000/api/jobs/abc/video');
    expect(api.videoUrl('abc', true)).toBe('http://localhost:4000/api/jobs/abc/video?download=1');
  });

  it('POSTs job requests as JSON and returns the id', async () => {
    const f = stubFetch(202, { id: 'job1' });
    const req = { script: 'Hi.', lang: 'hi' as const, voice: 'hf_alpha', speed: 1, bgm: false };
    expect(await api.createJob(req)).toEqual({ id: 'job1' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/jobs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(req);
  });

  it('surfaces the server error message on failure', async () => {
    stubFetch(400, { error: 'Script has 13 scenes; the maximum is 12. Merge some paragraphs.' });
    await expect(api.createJob({ script: 'x', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false })).rejects.toThrow(
      'Script has 13 scenes; the maximum is 12. Merge some paragraphs.',
    );
  });

  it('sends the session cookie with every request (credentials: include)', async () => {
    const f = stubFetch(200, []);
    await api.listJobs();
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].credentials).toBe('include');
  });

  it('throws AuthRequiredError on 401 so the app can show the login page', async () => {
    stubFetch(401, { error: 'Login required' });
    await expect(api.listJobs()).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('logs in with email and password and reads the session', async () => {
    const f = stubFetch(200, { authenticated: true, email: 'me@example.com' });
    expect(await api.login('me@example.com', 'pw')).toEqual({ authenticated: true, email: 'me@example.com' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/auth/login');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'me@example.com', password: 'pw' });
  });

  it('reports wrong credentials as a normal error (not AuthRequiredError)', async () => {
    stubFetch(401, { error: 'Invalid email or password' });
    const err = await api.login('me@example.com', 'bad').catch((e) => e);
    expect(err).not.toBeInstanceOf(AuthRequiredError);
    expect(err.message).toBe('Invalid email or password');
  });

  it('falls back to the HTTP status when the body has no error field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 503, statusText: 'Service Unavailable' })));
    await expect(api.voices()).rejects.toThrow('503 Service Unavailable');
  });
});
