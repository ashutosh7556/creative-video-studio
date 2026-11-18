import type { CameraMove } from '@cvs/shared';
import type gsap from 'gsap';
import type { PerspectiveCamera } from 'three';

export interface CamState {
  radius: number;
  angle: number; // radians around Y
  y: number;
  fov: number;
  lookY: number;
}

export interface CameraMoveDef {
  initial: CamState;
  build(tl: gsap.core.Timeline, state: CamState, durationSec: number): void;
}

const DEG = Math.PI / 180;

export const cameraMoves: Record<CameraMove, CameraMoveDef> = {
  dolly: {
    initial: { radius: 12, angle: 0, y: 1, fov: 50, lookY: 0 },
    build: (tl, s, d) => {
      tl.to(s, { radius: 8, y: 0.4, duration: d, ease: 'power2.inOut' }, 0);
    },
  },
  orbit: {
    initial: { radius: 10, angle: -25 * DEG, y: 0.8, fov: 50, lookY: 0 },
    build: (tl, s, d) => {
      tl.to(s, { angle: 25 * DEG, duration: d, ease: 'sine.inOut' }, 0);
    },
  },
  pushIn: {
    initial: { radius: 11, angle: 0.15, y: 0.6, fov: 58, lookY: 0.2 },
    build: (tl, s, d) => {
      tl.to(s, { radius: 9, fov: 44, lookY: 0, duration: d, ease: 'power1.inOut' }, 0);
    },
  },
};

export function applyCamera(camera: PerspectiveCamera, s: CamState): void {
  camera.position.set(Math.sin(s.angle) * s.radius, s.y, Math.cos(s.angle) * s.radius);
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(0, s.lookY, 0);
}
