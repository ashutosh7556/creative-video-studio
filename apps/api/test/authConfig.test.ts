import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from '../src/authConfig';

describe('loadAuthConfig', () => {
  it('reads email and password from the environment', () => {
    const r = loadAuthConfig({ AUTH_EMAIL: 'me@example.com', AUTH_PASSWORD: 'long-enough-pw', AUTH_SECRET: 'x'.repeat(32) });
    expect(r).toEqual({ ok: true, auth: { email: 'me@example.com', password: 'long-enough-pw', secret: 'x'.repeat(32) } });
  });

  it('generates a random session secret when AUTH_SECRET is not set', () => {
    const a = loadAuthConfig({ AUTH_EMAIL: 'me@example.com', AUTH_PASSWORD: 'long-enough-pw' });
    const b = loadAuthConfig({ AUTH_EMAIL: 'me@example.com', AUTH_PASSWORD: 'long-enough-pw' });
    if (!a.ok || !b.ok) throw new Error('expected ok');
    expect(a.auth.secret.length).toBeGreaterThanOrEqual(32);
    expect(a.auth.secret).not.toBe(b.auth.secret);
  });

  it('refuses to start without credentials, explaining where to set them', () => {
    const r = loadAuthConfig({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/AUTH_EMAIL and AUTH_PASSWORD/);
    expect(r.error).toMatch(/\.env/);
  });

  it('rejects the example placeholders and too-short passwords', () => {
    expect(loadAuthConfig({ AUTH_EMAIL: 'you@example.com', AUTH_PASSWORD: 'change-me-please' }).ok).toBe(false);
    expect(loadAuthConfig({ AUTH_EMAIL: 'me@example.com', AUTH_PASSWORD: 'short' }).ok).toBe(false);
    expect(loadAuthConfig({ AUTH_EMAIL: 'not-an-email', AUTH_PASSWORD: 'long-enough-pw' }).ok).toBe(false);
  });
});
