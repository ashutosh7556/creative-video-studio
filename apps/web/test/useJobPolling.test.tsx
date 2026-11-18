import type { JobRecord } from '@cvs/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import { useJobPolling } from '../src/hooks/useJobPolling';

const job = (status: JobRecord['status'], progress = 0): JobRecord => ({
  id: 'j1',
  createdAt: '2026-11-18T00:00:00Z',
  request: { script: 'x', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false },
  status,
  progress,
  warnings: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => {});

describe('useJobPolling', () => {
  it('returns null and does not fetch without an id', async () => {
    const spy = vi.spyOn(api, 'getJob');
    const { result } = renderHook(() => useJobPolling(null));
    await flush();
    expect(result.current).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('polls every 1 s while running and stops when done', async () => {
    const spy = vi
      .spyOn(api, 'getJob')
      .mockResolvedValueOnce(job('queued'))
      .mockResolvedValueOnce(job('running', 40))
      .mockResolvedValueOnce(job('done', 100));
    const { result } = renderHook(() => useJobPolling('j1'));
    await flush();
    expect(result.current?.status).toBe('queued');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current).toMatchObject({ status: 'running', progress: 40 });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current?.status).toBe('done');
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(spy).toHaveBeenCalledTimes(3); // no polling after a terminal state
  });

  it('keeps retrying (every 2 s) when the API is temporarily unreachable', async () => {
    const spy = vi
      .spyOn(api, 'getJob')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(job('failed'));
    const { result } = renderHook(() => useJobPolling('j1'));
    await flush();
    expect(result.current).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(result.current?.status).toBe('failed');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('stops polling on unmount', async () => {
    const spy = vi.spyOn(api, 'getJob').mockResolvedValue(job('running'));
    const { unmount } = renderHook(() => useJobPolling('j1'));
    await flush();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
