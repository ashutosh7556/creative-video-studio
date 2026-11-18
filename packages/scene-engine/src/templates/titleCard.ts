import * as THREE from 'three';
import type { SceneTemplate } from './registry';

const PALETTES = [
  { bg: 0x0b1026, colors: [0x5b8cff, 0xff6bcb, 0xffd166, 0x06d6a0], rim: 0x8f5bff },
  { bg: 0x120b1f, colors: [0xff7a59, 0xffc15e, 0x9b5de5, 0x00bbf9], rim: 0xff4d6d },
  { bg: 0x04151f, colors: [0x2ec4b6, 0xcbf3f0, 0xff9f1c, 0xe71d36], rim: 0x2ec4b6 },
  { bg: 0x1a1a2e, colors: [0xe94560, 0x3d7bd9, 0xf5f5f5, 0x53bf9d], rim: 0xe94560 },
];

const TAU = Math.PI * 2;

export const titleCard: SceneTemplate = {
  id: 'titleCard',
  build({ rng }) {
    const range = (min: number, max: number) => min + rng() * (max - min);
    const pal = PALETTES[Math.floor(rng() * PALETTES.length)];
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];

    group.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(5, 6, 8);
    group.add(key);
    const rim = new THREE.PointLight(pal.rim, 40, 30);
    rim.position.set(-6, -2, -4);
    group.add(rim);

    const geometries = [
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.TorusGeometry(0.8, 0.28, 16, 48),
      new THREE.BoxGeometry(1.2, 1.2, 1.2),
      new THREE.OctahedronGeometry(1, 0),
    ];
    disposables.push(...geometries);

    const count = 5 + Math.floor(rng() * 4);
    const shapes = Array.from({ length: count }, () => {
      const material = new THREE.MeshStandardMaterial({
        color: pal.colors[Math.floor(rng() * pal.colors.length)],
        roughness: 0.35,
        metalness: 0.2,
        flatShading: true,
      });
      disposables.push(material);
      const mesh = new THREE.Mesh(geometries[Math.floor(rng() * geometries.length)], material);
      const s = range(0.5, 1.3);
      mesh.scale.setScalar(s);
      const shape = {
        mesh,
        x: range(-7, 7),
        y: range(-3.5, 3.5),
        z: range(-6, 1),
        rx: range(0, TAU),
        ry: range(0, TAU),
        vx: range(-0.6, 0.6),
        vy: range(-0.6, 0.6),
        amp: range(0.2, 0.6),
        freq: range(0.3, 0.8),
        phase: range(0, TAU),
      };
      mesh.position.set(shape.x, shape.y, shape.z);
      group.add(mesh);
      return shape;
    });

    const positions = new Float32Array(400 * 3);
    for (let i = 0; i < 400; i++) {
      positions[i * 3] = range(-15, 15);
      positions[i * 3 + 1] = range(-9, 9);
      positions[i * 3 + 2] = range(-15, 5);
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.7 });
    disposables.push(pGeo, pMat);
    const points = new THREE.Points(pGeo, pMat);
    group.add(points);

    return {
      group,
      background: pal.bg,
      update(t) {
        for (const s of shapes) {
          s.mesh.rotation.set(s.rx + s.vx * t, s.ry + s.vy * t, 0);
          s.mesh.position.y = s.y + Math.sin(t * s.freq * TAU + s.phase) * s.amp;
        }
        points.rotation.y = t * 0.03;
      },
      dispose() {
        for (const d of disposables) d.dispose();
      },
    };
  },
};
