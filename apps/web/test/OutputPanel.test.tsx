import type { JobRecord } from '@cvs/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OutputPanel } from '../src/components/OutputPanel';

afterEach(cleanup);

const base: JobRecord = {
  id: 'abc123',
  createdAt: '2026-11-18T00:00:00Z',
  request: { script: 'x', lang: 'en-us', voice: 'af_heart', speed: 1, bgm: false },
  status: 'queued',
  progress: 0,
  warnings: [],
};

describe('OutputPanel', () => {
  it('shows a placeholder with no job', () => {
    render(<OutputPanel job={null} submitError={null} />);
    expect(screen.getByText('Your video will appear here.')).toBeTruthy();
  });

  it('shows submit errors', () => {
    render(<OutputPanel job={null} submitError="Script has 13 scenes" />);
    expect(screen.getByText('Script has 13 scenes')).toBeTruthy();
  });

  it('shows the stage label and progress while running', () => {
    render(<OutputPanel job={{ ...base, status: 'running', stage: 'render', progress: 64 }} submitError={null} />);
    expect(screen.getByText('Rendering video…')).toBeTruthy();
    expect(screen.getByText('64%')).toBeTruthy();
  });

  it('labels each stage', () => {
    const { rerender } = render(<OutputPanel job={{ ...base, status: 'running', stage: 'tts' }} submitError={null} />);
    expect(screen.getByText('Generating voice…')).toBeTruthy();
    rerender(<OutputPanel job={{ ...base, status: 'running', stage: 'audio' }} submitError={null} />);
    expect(screen.getByText('Mixing audio…')).toBeTruthy();
    rerender(<OutputPanel job={{ ...base, status: 'queued' }} submitError={null} />);
    expect(screen.getByText('Queued…')).toBeTruthy();
  });

  it('shows the error code and message on failure', () => {
    render(
      <OutputPanel
        job={{
          ...base,
          status: 'failed',
          error: { code: 'DURATION_EXCEEDED', message: 'Narration produces a 52.3 s video; the maximum is 45 s.' },
        }}
        submitError={null}
      />,
    );
    expect(screen.getByText('Generation failed (DURATION_EXCEEDED)')).toBeTruthy();
    expect(screen.getByText(/52.3 s video/)).toBeTruthy();
  });

  it('shows the video, duration, download link and warnings when done', () => {
    const { container } = render(
      <OutputPanel
        job={{
          ...base,
          status: 'done',
          progress: 100,
          result: { durationSec: 32.37, sceneCount: 4 },
          warnings: ['Background music was enabled but no file was found in assets/music; the video was rendered without music.'],
        }}
        submitError={null}
      />,
    );
    expect(container.querySelector('video')?.getAttribute('src')).toBe('http://localhost:4000/api/jobs/abc123/video');
    expect(screen.getByText('32.4 s · 4 scenes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download MP4' }).getAttribute('href')).toBe(
      'http://localhost:4000/api/jobs/abc123/video?download=1',
    );
    expect(screen.getByText(/no file was found in assets\/music/)).toBeTruthy();
  });
});
