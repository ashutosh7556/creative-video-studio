import type { JobRecord, JobStage } from '@cvs/shared';
import { api } from '../api';

const STAGE_LABELS: Record<JobStage, string> = {
  tts: 'Generating voice',
  audio: 'Mixing audio',
  render: 'Rendering video',
};

function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1 text-sm text-amber-300">
      {items.map((w, i) => (
        <li key={i}>⚠ {w}</li>
      ))}
    </ul>
  );
}

export function OutputPanel({ job, submitError }: { job: JobRecord | null; submitError: string | null }) {
  if (submitError) {
    return <div className="rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-300">{submitError}</div>;
  }
  if (!job) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">
        Your video will appear here.
      </div>
    );
  }
  if (job.status === 'queued' || job.status === 'running') {
    const label = job.status === 'queued' ? 'Queued' : job.stage ? STAGE_LABELS[job.stage] : 'Starting';
    return (
      <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-5">
        <div className="flex justify-between text-sm">
          <span>{label}…</span>
          <span className="text-slate-400">{job.progress}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${job.progress}%` }} />
        </div>
        <Warnings items={job.warnings} />
      </div>
    );
  }
  if (job.status === 'failed') {
    return (
      <div className="space-y-2 rounded-lg border border-red-800 bg-red-950/40 p-5">
        <div className="font-semibold text-red-300">Generation failed ({job.error?.code})</div>
        <p className="text-sm text-red-200">{job.error?.message}</p>
        <Warnings items={job.warnings} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <video key={job.id} src={api.videoUrl(job.id)} controls className="w-full rounded-lg bg-black" />
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">
          {job.result?.durationSec.toFixed(1)} s · {job.result?.sceneCount} scenes
        </span>
        <a
          href={api.videoUrl(job.id, true)}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
        >
          Download MP4
        </a>
      </div>
      <Warnings items={job.warnings} />
    </div>
  );
}
