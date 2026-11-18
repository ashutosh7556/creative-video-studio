import type { JobRecord } from '@cvs/shared';
import { api } from '../api';

const STATUS_STYLE: Record<JobRecord['status'], string> = {
  queued: 'text-slate-500',
  running: 'text-indigo-700',
  done: 'text-emerald-700',
  failed: 'text-red-600',
};

export function RecentJobs({ jobs, onSelect }: { jobs: JobRecord[]; onSelect(id: string): void }) {
  if (!jobs.length) return <p className="text-sm text-slate-500">No videos yet.</p>;
  return (
    <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
      {jobs.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
          <span className={`w-16 font-medium ${STATUS_STYLE[j.status]}`}>{j.status}</span>
          <button onClick={() => onSelect(j.id)} className="order-last w-full min-w-0 truncate text-left hover:text-indigo-700 sm:order-none sm:w-auto sm:flex-1">
            {j.request.script.slice(0, 80)}
          </button>
          <span className="text-xs text-slate-500 sm:text-sm">{new Date(j.createdAt).toLocaleString()}</span>
          {j.status === 'done' && (
            <a href={api.videoUrl(j.id, true)} className="text-emerald-700 hover:underline">
              Download
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
