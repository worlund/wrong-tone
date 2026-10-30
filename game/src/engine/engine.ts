// Composition root: owns the services, the world, the loop and the system lists.
// Game code registers systems and builds levels; the engine runs them in a fixed order:
//   per tick:  input command → sim systems (in registration order) → physics.step
//   per frame: mouse look → frame systems → render → debug overlay

import { FixedStepLoop, DEFAULT_LOOP } from './core/loop';
import { EventBus, type EventMap } from './core/events';
import type { FrameSystem, Service, SimSystem } from './core/system';
import { World } from './world/world';
import { Input, type InputCommand } from './input/input';
import { Physics } from './physics/physics';
import { Renderer } from './render/renderer';
import { AudioEngine } from './audio/audio';
import { DebugOverlay } from './debug/overlay';

export interface EngineDeps {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
}

export class Engine<E extends EventMap = EventMap> {
  readonly world = new World();
  readonly events = new EventBus<E>();
  readonly input: Input;
  readonly physics = new Physics();
  readonly renderer: Renderer;
  readonly audio = new AudioEngine();
  readonly debug: DebugOverlay;
  readonly loop: FixedStepLoop;
  /** The local player's command for the tick being simulated. */
  command!: InputCommand;

  private readonly simSystems: SimSystem[] = [];
  private readonly frameSystems: FrameSystem[] = [];
  private simMs = 0;

  constructor(deps: EngineDeps) {
    this.input = new Input(deps.canvas);
    this.renderer = new Renderer(deps.canvas);
    this.debug = new DebugOverlay(deps.uiRoot);
    this.loop = new FixedStepLoop(
      {
        fixedUpdate: (step, tick) => this.fixedUpdate(step, tick),
        frameUpdate: (alpha, frameTime) => this.frameUpdate(alpha, frameTime),
      },
      DEFAULT_LOOP,
    );
  }

  /** Services in start-up order; disposed in reverse. */
  get services(): readonly Service[] {
    return [this.renderer, this.physics, this.audio, this.input];
  }

  async init(onProgress?: (service: string) => void): Promise<void> {
    for (const s of this.services) {
      onProgress?.(s.name);
      await s.init();
    }
    this.command = this.input.state.sampleCommand();
  }

  addSimSystem(system: SimSystem): void {
    this.simSystems.push(system);
  }

  addFrameSystem(system: FrameSystem): void {
    this.frameSystems.push(system);
  }

  start(): void {
    this.loop.start();
  }

  private fixedUpdate(step: number, tick: number): void {
    const t0 = performance.now();
    this.command = this.input.state.sampleCommand();
    for (const s of this.simSystems) s.fixedUpdate(this.world, step, tick);
    this.physics.step(step);
    this.simMs += performance.now() - t0;
  }

  private frameUpdate(alpha: number, frameTime: number): void {
    this.input.state.applyLook();
    if (this.input.state.consumeFramePress('debug')) this.debug.toggle();
    for (const s of this.frameSystems) s.frameUpdate(this.world, alpha, frameTime);

    const t0 = performance.now();
    this.renderer.render();
    const renderMs = performance.now() - t0;

    const info = this.renderer.renderer.info.render;
    const { width, height } = this.renderer.internalSize();
    this.debug.update({
      frameMs: frameTime * 1000,
      simMs: this.simMs,
      renderMs,
      drawCalls: info.drawCalls,
      triangles: info.triangles,
      backend: this.renderer.backend,
      resolution: `${width}×${height}`,
      ticksThisFrame: this.loop.ticksLastFrame,
    });
    this.simMs = 0;
  }

  dispose(): void {
    this.loop.stop();
    for (const s of [...this.simSystems, ...this.frameSystems]) s.dispose?.();
    for (const s of [...this.services].reverse()) s.dispose();
    this.events.clear();
  }
}
