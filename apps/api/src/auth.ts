import { createHmac, timingSafeEqual } from 'node:crypto';

/** Single-user login: credentials come from AUTH_EMAIL / AUTH_PASSWORD in the repo-root .env file. */
export interface AuthConfig {
  email: string;
  password: string;
  /** HMAC key for session cookies. */
  secret: string;
  sessionTtlMs?: number;
}

export const SESSION_COOKIE = 'cvs_session';
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 3_600_000;

/** Constant-time string comparison (hashing first makes lengths equal). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

const normEmail = (e: string) => e.trim().toLowerCase();

export function checkCredentials(cfg: AuthConfig, email: string, password: string): boolean {
  // Evaluate both comparisons (no short-circuit) so timing does not reveal which one failed.
  const emailOk = safeEqual(normEmail(email), normEmail(cfg.email));
  const passwordOk = safeEqual(password, cfg.password);
  return emailOk && passwordOk;
}

const sign = (cfg: AuthConfig, payload: string) => createHmac('sha256', cfg.secret).update(payload).digest('base64url');

/** Token = "<expiryMs>.<hmac>". Stateless; invalid once expired or if the secret changes. */
export function issueToken(cfg: AuthConfig, now = Date.now()): string {
  const exp = String(now + (cfg.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS));
  return `${exp}.${sign(cfg, exp)}`;
}

export function verifyToken(cfg: AuthConfig, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [exp, sig, extra] = token.split('.');
  if (!exp || !sig || extra !== undefined || !/^\d+$/.test(exp)) return false;
  return safeEqual(sig, sign(cfg, exp)) && Number(exp) > now;
}

/** In-memory failed-login counter per client key (IP). */
export class LoginLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.failures.set(key, list);
    return list;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  fail(key: string, now = Date.now()): void {
    this.recent(key, now).push(now);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}
