import { TRANSITION_FRAMES, type VideoSpec } from '@cvs/shared';
import gsap from 'gsap';
import * as THREE from 'three';
import { drawCaption } from './captionDraw';
import { applyCamera, cameraMoves, type CamState } from './cameraMoves';
import { loadFonts } from './fonts';
import { mulberry32 } from './rng';
import { getTemplate, registerTemplate, type TemplateInstance } from './templates/registry';
import { titleCard } from './templates/titleCard';
import { dipAlpha } from './transitions';

registerTemplate(titleCard);

export interface Engine {
  renderFrame(n: number): void;
  captureJpeg(quality: number): string;
  captureRawHash(): Promise<string>;
  dispose(): void;
}

interface BuiltScene {
  spec: VideoSpec['scenes'][number];
  inst: TemplateInstance;
  cam: CamState;
  tl: gsap.core.Timeline;
}

export async function createEngine(spec: VideoSpec, root: HTMLElement): Promise<Engine> {
  await loadFonts();

  // No real-time clock anywhere: GSAP is only driven by seek().
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.sleep();

  const { width: W, height: H, fps } = spec;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  root.appendChild(out);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');

  const scene3 = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);

  const scenes: BuiltScene[] = spec.scenes.map((s) => {
    const inst = getTemplate(s.template).build({ scene: s, rng: mulberry32(s.seed) });
    inst.group.visible = false;
    scene3.add(inst.group);
    const move = cameraMoves[s.cameraMove];
    const cam = { ...move.initial };
    const tl = gsap.timeline({ paused: true });
    move.build(tl, cam, s.frameCount / fps);
    return { spec: s, inst, cam, tl };
  });

  let active = -1;
  const sceneIndexAt = (n: number) => {
    for (let i = scenes.length - 1; i >= 0; i--) if (n >= scenes[i].spec.startFrame) return i;
    return 0;
  };

  function renderFrame(n: number): void {
    if (!Number.isInteger(n) || n < 0 || n >= spec.totalFrames) {
      throw new RangeError(`Frame ${n} out of range 0..${spec.totalFrames - 1}`);
    }
    const i = sceneIndexAt(n);
    const s = scenes[i];
    if (i !== active) {
      if (active >= 0) scenes[active].inst.group.visible = false;
      s.inst.group.visible = true;
      scene3.background = new THREE.Color(s.inst.background);
      active = i;
    }
    const localFrame = n - s.spec.startFrame;
    const localSec = localFrame / fps;
    s.tl.seek(localSec, false);
    applyCamera(camera, s.cam);
    s.inst.update(localSec);
    renderer.render(scene3, camera);

    ctx!.globalAlpha = 1;
    ctx!.drawImage(renderer.domElement, 0, 0);
    const cue = s.spec.captions.find((c) => n >= c.startFrame && n < c.endFrame);
    if (cue) drawCaption(ctx!, cue, n, fps, spec.fontFamily, W, H);
    const dip = dipAlpha(localFrame, s.spec.frameCount, TRANSITION_FRAMES);
    if (dip > 0) {
      ctx!.fillStyle = `rgba(0, 0, 0, ${dip})`;
      ctx!.fillRect(0, 0, W, H);
    }
  }

  return {
    renderFrame,
    captureJpeg(quality) {
      return out.toDataURL('image/jpeg', quality).slice('data:image/jpeg;base64,'.length);
    },
    async captureRawHash() {
      const data = ctx.getImageData(0, 0, W, H).data;
      const digest = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    },
    dispose() {
      for (const s of scenes) s.inst.dispose();
      renderer.dispose();
      out.remove();
    },
  };
}
