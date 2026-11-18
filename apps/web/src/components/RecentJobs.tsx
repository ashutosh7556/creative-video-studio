import type { JobRecord } from '@cvs/shared';
import { api } from '../api';

const STATUS_STYLE: Record<JobRecord['status'], string> = {
  queued: 'text-slate-400',
  running: 'text-indigo-300',
  done: 'text-emerald-400',
  failed: 'text-red-400',
};

export function RecentJobs({ jobs, onSelect }: { jobs: JobRecord[]; onSelect(id: string): void }) {
  if (!jobs.length) return <p className="text-sm text-slate-500">No videos yet.</p>;
  return (
    <ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
      {jobs.map((j) => (
        <li key={j.id} className="flex items-center gap-4 px-4 py-3 text-sm">
          <span className={`w-16 font-medium ${STATUS_STYLE[j.status]}`}>{j.status}</span>
          <button onClick={() => onSelect(j.id)} className="flex-1 truncate text-left hover:text-indigo-300">
            {j.request.script.slice(0, 80)}
          </button>
          <span className="text-slate-500">{new Date(j.createdAt).toLocaleString()}</span>
          {j.status === 'done' && (
            <a href={api.videoUrl(j.id, true)} className="text-emerald-400 hover:underline">
              Download
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
