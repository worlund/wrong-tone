// Lifecycle contracts. Every subsystem and gameplay system implements a subset,
// so a level can be torn down and reloaded cleanly.

import type { World } from '../world/world';

/** Engine services that own a browser or library resource (GPU, AudioContext, WASM). */
export interface Service {
  readonly name: string;
  init(): Promise<void> | void;
  dispose(): void;
}

/** Runs inside the fixed simulation step. Must not touch Three.js or the DOM. */
export interface SimSystem {
  readonly name: string;
  fixedUpdate(world: World, step: number, tick: number): void;
  dispose?(): void;
}

/** Runs once per rendered frame: reads simulation state, never writes it. */
export interface FrameSystem {
  readonly name: string;
  frameUpdate(world: World, alpha: number, frameTime: number): void;
  dispose?(): void;
}
