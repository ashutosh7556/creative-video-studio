import { describe, expect, it } from 'vitest';
import { LoginLimiter, checkCredentials, issueToken, parseCookies, verifyToken, type AuthConfig } from '../src/auth';

const cfg: AuthConfig = { email: 'Owner@Example.com', password: 'correct horse', secret: 's3cret', sessionTtlMs: 1000 };

describe('checkCredentials', () => {
  it('accepts the configured email (case/space-insensitive) and exact password', () => {
    expect(checkCredentials(cfg, ' owner@example.com ', 'correct horse')).toBe(true);
  });
  it('rejects a wrong password, wrong email or empty input', () => {
    expect(checkCredentials(cfg, 'owner@example.com', 'correct horsE')).toBe(false);
    expect(checkCredentials(cfg, 'other@example.com', 'correct horse')).toBe(false);
    expect(checkCredentials(cfg, '', '')).toBe(false);
  });
});

describe('session tokens', () => {
  it('verifies a fresh token and rejects it after expiry', () => {
    const t = issueToken(cfg, 10_000);
    expect(verifyToken(cfg, t, 10_500)).toBe(true);
    expect(verifyToken(cfg, t, 11_001)).toBe(false);
  });
  it('rejects tampered tokens and tokens signed with another secret', () => {
    const t = issueToken(cfg, 10_000);
    const [exp, sig] = t.split('.');
    expect(verifyToken(cfg, `${Number(exp) + 999999}.${sig}`, 10_500)).toBe(false);
    expect(verifyToken({ ...cfg, secret: 'other' }, t, 10_500)).toBe(false);
    expect(verifyToken(cfg, 'garbage', 10_500)).toBe(false);
    expect(verifyToken(cfg, undefined, 10_500)).toBe(false);
  });
});

describe('LoginLimiter', () => {
  it('blocks after 5 failures within the window and unblocks after it', () => {
    const l = new LoginLimiter(5, 1000);
    for (let i = 0; i < 4; i++) l.fail('ip', 0);
    expect(l.isBlocked('ip', 10)).toBe(false);
    l.fail('ip', 10);
    expect(l.isBlocked('ip', 20)).toBe(true);
    expect(l.isBlocked('other-ip', 20)).toBe(false);
    expect(l.isBlocked('ip', 1011)).toBe(false);
  });
  it('reset clears failures after a successful login', () => {
    const l = new LoginLimiter(2, 1000);
    l.fail('ip', 0);
    l.reset('ip');
    l.fail('ip', 1);
    expect(l.isBlocked('ip', 2)).toBe(false);
  });
});

describe('parseCookies', () => {
  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; cvs_session=abc.def%3D; b=2')).toEqual({ a: '1', cvs_session: 'abc.def=', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
  });
});
