import type { ApiConfig, HealthStatus, JobRecord, JobRequest, VoicesByLang } from '@cvs/shared';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export const api = {
  health: () => json<HealthStatus>('/api/health'),
  config: () => json<ApiConfig>('/api/config'),
  voices: () => json<VoicesByLang>('/api/voices'),
  listJobs: () => json<JobRecord[]>('/api/jobs'),
  getJob: (id: string) => json<JobRecord>(`/api/jobs/${id}`),
  createJob: (req: JobRequest) =>
    json<{ id: string }>('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }),
  videoUrl: (id: string, download = false) => `${BASE}/api/jobs/${id}/video${download ? '?download=1' : ''}`,
};
