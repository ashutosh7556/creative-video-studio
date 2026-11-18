import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { api } from '../src/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const config = { bgmAvailable: false, maxScenes: 12, maxDurationSec: 45, minTargetSec: 30, rates: { 'en-us': 2.8, 'en-gb': 2.8, hi: 2.4 } };

function mockDashboardApis(tts: 'ok' | 'unreachable' = 'ok') {
  vi.spyOn(api, 'config').mockResolvedValue(config);
  vi.spyOn(api, 'health').mockResolvedValue({ api: 'ok', tts });
  vi.spyOn(api, 'voices').mockResolvedValue({ 'en-us': ['af_heart'], 'en-gb': ['bf_emma'], hi: ['hf_alpha'] });
  vi.spyOn(api, 'listJobs').mockResolvedValue([]);
}

describe('App', () => {
  it('shows only the login page when not signed in', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ authenticated: false });
    const listJobs = vi.spyOn(api, 'listJobs');
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('New video')).toBeNull();
    expect(listJobs).not.toHaveBeenCalled();
  });

  it('opens the dashboard after a successful login, and logout returns to the login page', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ authenticated: false });
    vi.spyOn(api, 'login').mockResolvedValue({ authenticated: true, email: 'me@example.com' });
    const logout = vi.spyOn(api, 'logout').mockResolvedValue({ authenticated: false });
    mockDashboardApis();
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'me@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('New video')).toBeTruthy();
    expect(screen.getByText('me@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(logout).toHaveBeenCalled();
  });

  it('shows a banner when the TTS service is not running', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ authenticated: true, email: 'me@example.com' });
    mockDashboardApis('unreachable');
    render(<App />);
    expect(await screen.findByText(/TTS service is not running/)).toBeTruthy();
    expect(await screen.findByText('No videos yet.')).toBeTruthy();
  });

  it('shows how to start the API when it is unreachable', async () => {
    vi.spyOn(api, 'me').mockRejectedValue(new Error('Failed to fetch'));
    render(<App />);
    expect(await screen.findByText(/API not reachable \(Failed to fetch\)/)).toBeTruthy();
  });
});
