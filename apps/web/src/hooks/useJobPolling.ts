import type { JobRecord } from '@cvs/shared';
import { useEffect, useState } from 'react';
import { api } from '../api';

const isActive = (j: JobRecord) => j.status === 'queued' || j.status === 'running';

/** Polls a job every 1 s while it is queued or running; retries every 2 s if the API is unreachable. */
export function useJobPolling(id: string | null): JobRecord | null {
  const [job, setJob] = useState<JobRecord | null>(null);
  useEffect(() => {
    setJob(null);
    if (!id) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const j = await api.getJob(id);
        if (cancelled) return;
        setJob(j);
        if (isActive(j)) timer = window.setTimeout(tick, 1000);
      } catch {
        if (!cancelled) timer = window.setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [id]);
  return job;
}
