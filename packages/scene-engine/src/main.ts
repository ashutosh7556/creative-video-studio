import type { VideoSpec } from '@cvs/shared';
import { createEngine, type Engine } from './engine';

declare global {
  interface Window {
    __engineReady: boolean;
    __engine: {
      init(spec: VideoSpec): Promise<true>;
      renderFrame(n: number): void;
      captureJpeg(quality: number): string;
      captureRawHash(): Promise<string>;
    };
  }
}

let engine: Engine | null = null;
const need = () => {
  if (!engine) throw new Error('Engine not initialised; call __engine.init(spec) first');
  return engine;
};

window.__engine = {
  async init(spec) {
    engine?.dispose();
    engine = await createEngine(spec, document.body);
    return true;
  },
  renderFrame: (n) => need().renderFrame(n),
  captureJpeg: (q) => need().captureJpeg(q),
  captureRawHash: () => need().captureRawHash(),
};
window.__engineReady = true;
