import { errorMessage, type ApiConfig, type HealthStatus, type JobRecord, type JobRequest, type VoicesByLang } from '@cvs/shared';
import { useCallback, useEffect, useState } from 'react';
import { AuthRequiredError, api } from './api';
import { OutputPanel } from './components/OutputPanel';
import { RecentJobs } from './components/RecentJobs';
import { ScriptForm } from './components/ScriptForm';
import { useJobPolling } from './hooks/useJobPolling';

/** The video studio itself; shown only after login. */
export function Dashboard({ email, onLogout, onAuthLost }: { email: string; onLogout(): void; onAuthLost(): void }) {
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [voices, setVoices] = useState<VoicesByLang | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const job = useJobPolling(jobId);

  const refreshJobs = useCallback(() => {
    api.listJobs().then(setJobs).catch(() => undefined);
  }, []);

  useEffect(() => {
    Promise.all([api.config(), api.health()])
      .then(([c, h]) => {
        setConfig(c);
        setHealth(h);
      })
      .catch((e) =>
        e instanceof AuthRequiredError
          ? onAuthLost()
          : setApiError(`API not reachable (${errorMessage(e)}). Start it with \`npm run dev:api\`.`),
      );
    api.voices().then(setVoices).catch(() => setVoices(null));
    refreshJobs();
  }, [refreshJobs, onAuthLost]);

  useEffect(() => {
    if (job?.status === 'done' || job?.status === 'failed') refreshJobs();
  }, [job?.status, refreshJobs]);

  const busy = job?.status === 'queued' || job?.status === 'running';

  async function submit(req: JobRequest) {
    setSubmitError(null);
    try {
      const { id } = await api.createJob(req);
      setJobId(id);
      refreshJobs();
    } catch (e) {
      setSubmitError(errorMessage(e));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Creative Video Studio</h1>
          <p className="text-sm text-slate-400">Paste a script, pick a voice, generate a narrated 3D video.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">{email}</span>
          <button onClick={onLogout} className="rounded-lg border border-slate-700 px-3 py-1.5 hover:bg-slate-800">
            Log out
          </button>
        </div>
      </header>

      {apiError && <div className="rounded-lg bg-red-950/50 p-3 text-sm text-red-300">{apiError}</div>}
      {health?.tts === 'unreachable' && (
        <div className="rounded-lg bg-amber-950/50 p-3 text-sm text-amber-300">
          TTS service is not running. Start it with <code>npm run dev:tts</code>, then reload.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">New video</h2>
          <ScriptForm voices={voices} config={config} disabled={busy} onSubmit={submit} />
        </section>
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="mb-4 text-lg font-semibold">Output</h2>
          <OutputPanel job={job} submitError={submitError} />
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent videos</h2>
        <RecentJobs jobs={jobs} onSelect={setJobId} />
      </section>
    </div>
  );
}
