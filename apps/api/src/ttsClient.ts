import { PipelineError, errorMessage, type Lang, type VoicesByLang } from '@cvs/shared';

export interface SynthesizeRequest {
  text: string;
  lang: Lang;
  voice: string;
  speed: number;
}

export interface TtsLike {
  readonly baseUrl: string;
  health(): Promise<boolean>;
  voices(): Promise<VoicesByLang>;
  synthesize(req: SynthesizeRequest, sceneNo: number): Promise<{ wav: Buffer; headerSec: number }>;
}

export interface TtsClientOptions {
  /** Per /synthesize attempt. */
  requestTimeoutMs?: number;
  healthTimeoutMs?: number;
}

const isTimeout = (err: unknown) => err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

export class TtsClient implements TtsLike {
  private readonly requestTimeoutMs: number;
  private readonly healthTimeoutMs: number;

  constructor(
    readonly baseUrl: string,
    opts: TtsClientOptions = {},
  ) {
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
    this.healthTimeoutMs = opts.healthTimeoutMs ?? 3_000;
  }

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(this.healthTimeoutMs) });
      return r.ok;
    } catch {
      return false;
    }
  }

  async voices(): Promise<VoicesByLang> {
    const r = await fetch(`${this.baseUrl}/voices`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`TTS /voices returned ${r.status}`);
    return (await r.json()) as VoicesByLang;
  }

  /** 4xx: fail now. 5xx, timeout or network error: retry once, then fail. */
  async synthesize(req: SynthesizeRequest, sceneNo: number): Promise<{ wav: Buffer; headerSec: number }> {
    let lastMessage = 'unknown error';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/synthesize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
        if (res.ok) {
          return { wav: Buffer.from(await res.arrayBuffer()), headerSec: Number(res.headers.get('x-duration')) };
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        lastMessage = body.error ?? `HTTP ${res.status}`;
        if (res.status < 500) break;
      } catch (err) {
        lastMessage = isTimeout(err)
          ? `TTS request timed out after ${this.requestTimeoutMs} ms`
          : `TTS request failed (${errorMessage(err)})`;
      }
    }
    throw new PipelineError('TTS_FAILED', `Scene ${sceneNo}: ${lastMessage}`);
  }
}
