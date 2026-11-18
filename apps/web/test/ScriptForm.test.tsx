import type { ApiConfig, VoicesByLang } from '@cvs/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScriptForm } from '../src/components/ScriptForm';

afterEach(cleanup);

const voices: VoicesByLang = {
  'en-us': ['af_bella', 'af_heart', 'am_adam'],
  'en-gb': ['bf_emma', 'bm_george'],
  hi: ['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi'],
};
const config: ApiConfig = {
  bgmAvailable: false,
  maxScenes: 12,
  maxDurationSec: 45,
  minTargetSec: 30,
  rates: { 'en-us': 2.8, 'en-gb': 2.8, hi: 2.4 },
};

function setup(over: Partial<Parameters<typeof ScriptForm>[0]> = {}) {
  const onSubmit = vi.fn();
  render(<ScriptForm voices={voices} config={config} disabled={false} onSubmit={onSubmit} {...over} />);
  const script = screen.getByLabelText('Script');
  const button = screen.getByRole('button', { name: 'Generate Video' });
  return { onSubmit, script, button };
}

const words = (n: number) => Array(n).fill('word').join(' ');

describe('ScriptForm', () => {
  it('shows live scene count and estimated duration', () => {
    const { script } = setup();
    // 2 scenes × 28 words at 2.8 w/s = 20 s + 2 × 0.6 s pad = 21.2 s
    fireEvent.change(script, { target: { value: `${words(28)}\n\n${words(28)}` } });
    expect(screen.getByText(/2 scenes · ≈ 21 s \(estimate\)/)).toBeTruthy();
    expect(screen.getByText(/Shorter than the 30–45 s target/)).toBeTruthy();
  });

  it('warns when the estimate exceeds 45 s but still allows generation', () => {
    const { script, button } = setup();
    fireEvent.change(script, { target: { value: words(140) } });
    expect(screen.getByText(/Likely over 45 s/)).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('blocks more than 12 scenes', () => {
    const { script, button } = setup();
    fireEvent.change(script, { target: { value: Array.from({ length: 13 }, (_, i) => `S${i}`).join('\n\n') } });
    expect(screen.getByText(/Too many scenes: maximum is 12/)).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Generate for an empty script', () => {
    const { button } = setup();
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('defaults to af_heart and switches to Hindi voices (hf_alpha default, all selectable)', () => {
    setup();
    const voice = screen.getByLabelText('Voice') as HTMLSelectElement;
    expect(voice.value).toBe('af_heart');
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'hi' } });
    expect(voice.value).toBe('hf_alpha');
    expect(Array.from(voice.options).map((o) => o.value)).toEqual(['hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi']);
  });

  it('submits the full request', () => {
    const { script, button, onSubmit } = setup({ config: { ...config, bgmAvailable: true } });
    fireEvent.change(script, { target: { value: 'नमस्ते दोस्तों।\n\nदूसरा दृश्य।' } });
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'hi' } });
    fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'hm_omega' } });
    fireEvent.change(screen.getByLabelText(/Speed/), { target: { value: '1.25' } });
    fireEvent.click(screen.getByLabelText('Background music'));
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledWith({
      script: 'नमस्ते दोस्तों।\n\nदूसरा दृश्य।',
      lang: 'hi',
      voice: 'hm_omega',
      speed: 1.25,
      bgm: true,
    });
  });

  it('disables the BGM toggle with a hint when no music file is available', () => {
    setup();
    expect((screen.getByLabelText('Background music') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/add an audio file to assets\/music/)).toBeTruthy();
  });

  it('cannot generate when voices are unavailable (TTS down)', () => {
    const { script, button } = setup({ voices: null });
    fireEvent.change(script, { target: { value: 'Hello.' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Voices unavailable')).toBeTruthy();
  });

  it('shows Generating… and stays disabled while a job is running', () => {
    render(<ScriptForm voices={voices} config={config} disabled onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Script'), { target: { value: 'Hello.' } });
    expect((screen.getByRole('button', { name: 'Generating…' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
