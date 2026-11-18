import { randomBytes } from 'node:crypto';
import type { AuthConfig } from './auth';

const PLACEHOLDERS = new Set(['you@example.com', 'change-me-please']);
const MIN_PASSWORD_LENGTH = 8;

export type AuthConfigResult = { ok: true; auth: AuthConfig } | { ok: false; error: string };

/** Reads login credentials from env (loaded from the repo-root .env file by server.ts). */
export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfigResult {
  const email = env.AUTH_EMAIL?.trim() ?? '';
  const password = env.AUTH_PASSWORD ?? '';
  if (!email || !password) {
    return {
      ok: false,
      error:
        'Login is not configured. Set AUTH_EMAIL and AUTH_PASSWORD in the .env file at the repo root ' +
        '(copy .env.example to .env and edit it), then restart the API.',
    };
  }
  if (PLACEHOLDERS.has(email.toLowerCase()) || PLACEHOLDERS.has(password)) {
    return { ok: false, error: 'AUTH_EMAIL / AUTH_PASSWORD in .env still contain the example values. Change them.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: `AUTH_EMAIL "${email}" in .env is not a valid email address.` };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `AUTH_PASSWORD in .env must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  // Without AUTH_SECRET a fresh secret is generated, so sessions end when the API restarts.
  const secret = env.AUTH_SECRET?.trim() || randomBytes(32).toString('hex');
  return { ok: true, auth: { email, password, secret } };
}
