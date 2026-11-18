import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { api } from '../src/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const config = { bgmAvailable: false, maxScenes: 12, maxDurationSec: 45, minTargetSec: 30, rates: { 'en-us': 2.8, 'en-gb': 2.8, hi: 2.4 } };

describe('App', () => {
  it('shows a banner when the TTS service is not running', async () => {
    vi.spyOn(api, 'config').mockResolvedValue(config);
    vi.spyOn(api, 'health').mockResolvedValue({ api: 'ok', tts: 'unreachable' });
    vi.spyOn(api, 'voices').mockRejectedValue(new Error('down'));
    vi.spyOn(api, 'listJobs').mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByText(/TTS service is not running/)).toBeTruthy();
    expect(screen.getByText('No videos yet.')).toBeTruthy();
  });

  it('shows how to start the API when it is unreachable', async () => {
    vi.spyOn(api, 'config').mockRejectedValue(new Error('Failed to fetch'));
    vi.spyOn(api, 'health').mockRejectedValue(new Error('Failed to fetch'));
    vi.spyOn(api, 'voices').mockRejectedValue(new Error('Failed to fetch'));
    vi.spyOn(api, 'listJobs').mockRejectedValue(new Error('Failed to fetch'));
    render(<App />);
    expect(await screen.findByText(/API not reachable \(Failed to fetch\)/)).toBeTruthy();
  });
});
