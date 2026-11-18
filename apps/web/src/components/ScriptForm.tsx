import {
  DEFAULT_VOICES,
  LANGS,
  LANG_LABELS,
  MAX_DURATION_SEC,
  MAX_SCENES,
  MIN_TARGET_SEC,
  estimateDurationSec,
  parseParagraphs,
  type ApiConfig,
  type JobRequest,
  type Lang,
  type VoicesByLang,
} from '@cvs/shared';
import { useEffect, useMemo, useState } from 'react';

interface Props {
  voices: VoicesByLang | null;
  config: ApiConfig | null;
  disabled: boolean;
  onSubmit(req: JobRequest): void;
}

const PLACEHOLDER = `Paste your script here.

Each paragraph becomes one scene. Separate scenes with a blank line.

Aim for 30–45 seconds of narration.`;

const fieldLabel = 'mb-1 block text-sm font-medium text-slate-300';
const selectCls = 'w-full rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm disabled:opacity-50';

export function ScriptForm({ voices, config, disabled, onSubmit }: Props) {
  const [script, setScript] = useState('');
  const [lang, setLang] = useState<Lang>('en-us');
  const [voice, setVoice] = useState(DEFAULT_VOICES['en-us']);
  const [speed, setSpeed] = useState(1);
  const [bgm, setBgm] = useState(false);

  const langVoices = useMemo(() => voices?.[lang] ?? [], [voices, lang]);
  useEffect(() => {
    if (langVoices.length && !langVoices.includes(voice)) {
      setVoice(langVoices.includes(DEFAULT_VOICES[lang]) ? DEFAULT_VOICES[lang] : langVoices[0]);
    }
  }, [lang, langVoices, voice]);

  const scenes = useMemo(() => parseParagraphs(script), [script]);
  const estimate = useMemo(() => estimateDurationSec(scenes, lang, speed), [scenes, lang, speed]);
  const tooMany = scenes.length > MAX_SCENES;
  const canSubmit = !disabled && scenes.length > 0 && !tooMany && langVoices.includes(voice);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit({ script, lang, voice, speed, bgm });
      }}
    >
      <div>
        <label htmlFor="script" className={fieldLabel}>
          Script
        </label>
        <textarea
          id="script"
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={PLACEHOLDER}
          rows={14}
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm leading-relaxed focus:border-indigo-500 focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
          <span className="text-slate-400">
            {scenes.length} scene{scenes.length === 1 ? '' : 's'} · ≈ {estimate.toFixed(0)} s (estimate)
          </span>
          {tooMany && <span className="text-red-400">Too many scenes: maximum is {MAX_SCENES}.</span>}
          {!tooMany && estimate > MAX_DURATION_SEC && (
            <span className="text-amber-400">
              Likely over {MAX_DURATION_SEC} s; generation will fail if the narration is too long.
            </span>
          )}
          {scenes.length > 0 && estimate < MIN_TARGET_SEC && (
            <span className="text-slate-500">Shorter than the 30–45 s target.</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="lang" className={fieldLabel}>
            Language
          </label>
          <select id="lang" value={lang} onChange={(e) => setLang(e.target.value as Lang)} className={selectCls}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="voice" className={fieldLabel}>
            Voice
          </label>
          <select
            id="voice"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={!langVoices.length}
            className={selectCls}
          >
            {langVoices.length === 0 && <option>Voices unavailable</option>}
            {langVoices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-sm">
          <label htmlFor="speed" className="font-medium text-slate-300">
            Speed
          </label>
          <span className="text-slate-400">{speed.toFixed(2)}×</span>
        </div>
        <input
          id="speed"
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <input
          id="bgm"
          type="checkbox"
          checked={bgm}
          disabled={!config?.bgmAvailable}
          onChange={(e) => setBgm(e.target.checked)}
          className="accent-indigo-500"
        />
        <label htmlFor="bgm" className={config?.bgmAvailable ? '' : 'text-slate-500'}>
          Background music
        </label>
        {!config?.bgmAvailable && (
          <span className="text-xs text-slate-500">(add an audio file to assets/music to enable)</span>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-indigo-600 py-3 font-semibold hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {disabled ? 'Generating…' : 'Generate Video'}
      </button>
    </form>
  );
}
