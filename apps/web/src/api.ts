import type { ApiConfig, HealthStatus, JobRecord, JobRequest, VoicesByLang } from '@cvs/shared';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export interface AuthStatus {
  authenticated: boolean;
  email?: string;
}

/** Thrown when the session is missing or expired; the app responds by showing the login page. */
export class AuthRequiredError extends Error {
  constructor() {
    super('Login required');
    this.name = 'AuthRequiredError';
  }
}

async function json<T>(path: string, init?: RequestInit, { sessionRequired = true } = {}): Promise<T> {
  // credentials: 'include' sends the HttpOnly session cookie to the API (different port, same site).
  const res = await fetch(`${BASE}${path}`, { ...init, credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && sessionRequired) throw new AuthRequiredError();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  me: () => json<AuthStatus>('/api/auth/me'),
  login: (email: string, password: string) =>
    json<AuthStatus>('/api/auth/login', post({ email, password }), { sessionRequired: false }),
  logout: () => json<AuthStatus>('/api/auth/logout', post()),
  health: () => json<HealthStatus>('/api/health'),
  config: () => json<ApiConfig>('/api/config'),
  voices: () => json<VoicesByLang>('/api/voices'),
  listJobs: () => json<JobRecord[]>('/api/jobs'),
  getJob: (id: string) => json<JobRecord>(`/api/jobs/${id}`),
  createJob: (req: JobRequest) => json<{ id: string }>('/api/jobs', post(req)),
  videoUrl: (id: string, download = false) => `${BASE}/api/jobs/${id}/video${download ? '?download=1' : ''}`,
};
