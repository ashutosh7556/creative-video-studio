import type { SceneSpec } from '@cvs/shared';
import type { Group } from 'three';

export interface TemplateInstance {
  group: Group;
  background: number;
  /** Pure function of scene-local time in seconds. */
  update(tSec: number): void;
  dispose(): void;
}

export interface SceneTemplate {
  id: string;
  build(ctx: { scene: SceneSpec; rng: () => number }): TemplateInstance;
}

const registry = new Map<string, SceneTemplate>();

export function registerTemplate(t: SceneTemplate): void {
  registry.set(t.id, t);
}

export function getTemplate(id: string): SceneTemplate {
  const t = registry.get(id);
  if (!t) throw new Error(`Unknown scene template "${id}"`);
  return t;
}
