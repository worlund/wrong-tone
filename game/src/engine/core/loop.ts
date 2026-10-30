// Fixed-timestep game loop ("Fix Your Timestep"): the simulation advances in
// constant steps, rendering runs every animation frame and interpolates.

export interface LoopOptions {
  /** Simulation step in seconds. */
  step: number;
  /** Longest frame time fed to the accumulator, so a stall can't trigger a catch-up spiral. */
  maxFrameTime: number;
}

export interface LoopHooks {
  /** Called 0..n times per frame with the fixed step. Advance the simulation here. */
  fixedUpdate(step: number, tick: number): void;
  /**
   * Called once per animation frame after the fixed updates.
   * alpha: 0..1, how far we are between the previous and current simulation state.
   * frameTime: real seconds since the last frame (for camera look, UI, effects).
   */
  frameUpdate(alpha: number, frameTime: number): void;
}

export const DEFAULT_LOOP: LoopOptions = { step: 1 / 60, maxFrameTime: 0.25 };

export class FixedStepLoop {
  tick = 0;
  /** Fixed updates run during the last frame (0 when rendering faster than 60 Hz). */
  ticksLastFrame = 0;
  /** While paused, frames still render but the simulation doesn't advance. */
  paused = false;

  private accumulator = 0;
  private rafId = 0;
  private lastTime = -1;

  constructor(
    private readonly hooks: LoopHooks,
    private readonly options: LoopOptions = DEFAULT_LOOP,
  ) {}

  /**
   * Advances the loop by one frame of `frameTime` seconds. Pure and deterministic,
   * so it can be unit tested without requestAnimationFrame.
   */
  advance(frameTime: number): void {
    const { step, maxFrameTime } = this.options;
    const dt = Math.min(Math.max(frameTime, 0), maxFrameTime);
    let ticks = 0;
    if (this.paused) {
      this.accumulator = 0;
    } else {
      this.accumulator += dt;
      while (this.accumulator >= step) {
        this.hooks.fixedUpdate(step, this.tick);
        this.tick++;
        this.accumulator -= step;
        ticks++;
      }
    }
    this.ticksLastFrame = ticks;
    this.hooks.frameUpdate(this.accumulator / step, dt);
  }

  /** Starts driving `advance` from requestAnimationFrame. */
  start(): void {
    if (this.rafId) return;
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      const frameTime = this.lastTime < 0 ? 0 : (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.advance(frameTime);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastTime = -1;
  }
}
