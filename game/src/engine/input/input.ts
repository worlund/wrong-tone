// Collects browser input events and exposes them in two forms:
// - a per-tick InputCommand for the simulation (what a co-op client would send to the host)
// - mouse look applied every rendered frame, so the camera never waits for a tick.

import type { Service } from '../core/system';
import { ACTIONS, type Action, DEFAULT_BINDINGS } from './actions';

/** Everything the simulation needs from one player for one tick. Plain data. */
export interface InputCommand {
  /** Movement intent in local space: x = right, z = forward. Length ≤ 1. */
  moveX: number;
  moveZ: number;
  /** Camera yaw/pitch (radians) at the end of this tick, from the frame-rate look. */
  yaw: number;
  pitch: number;
  held: ReadonlySet<Action>;
  /** Actions that went down since the previous tick (edge-triggered: interact, jump). */
  pressed: ReadonlySet<Action>;
}

export interface Look {
  yaw: number;
  pitch: number;
}

const MAX_PITCH = (89 * Math.PI) / 180;

/** Browser-free input state machine. The DOM layer feeds it; tests drive it directly. */
export class InputState {
  readonly look: Look = { yaw: 0, pitch: 0 };
  /** Radians per mouse count. */
  sensitivity = 0.0022;
  invertY = false;

  private codeToActions = new Map<string, Action[]>();
  private downCodes = new Set<string>();
  private held = new Set<Action>();
  private pressedSinceTick = new Set<Action>();
  private pressedSinceFrame = new Set<Action>();
  private dx = 0;
  private dy = 0;
  private command: InputCommand & { held: Set<Action>; pressed: Set<Action> } = {
    moveX: 0, moveZ: 0, yaw: 0, pitch: 0, held: new Set(), pressed: new Set(),
  };

  constructor(bindings: Record<Action, readonly string[]> = DEFAULT_BINDINGS) {
    for (const action of ACTIONS) {
      for (const code of bindings[action]) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }
  }

  /** Returns true when the code is bound (so the DOM layer can preventDefault). */
  keyDown(code: string, repeat = false): boolean {
    const actions = this.codeToActions.get(code);
    if (!actions) return false;
    if (repeat || this.downCodes.has(code)) return true;
    this.downCodes.add(code);
    for (const a of actions) {
      if (!this.held.has(a)) {
        this.pressedSinceTick.add(a);
        this.pressedSinceFrame.add(a);
      }
    }
    this.recomputeHeld();
    return true;
  }

  keyUp(code: string): void {
    if (this.downCodes.delete(code)) this.recomputeHeld();
  }

  /** Focus lost: the browser won't send keyups, so release everything. */
  releaseAll(): void {
    this.downCodes.clear();
    this.held.clear();
  }

  mouseMove(dx: number, dy: number): void {
    this.dx += dx;
    this.dy += dy;
  }

  /** Applies accumulated mouse movement to the look angles. Call once per rendered frame. */
  applyLook(): Look {
    this.look.yaw -= this.dx * this.sensitivity;
    this.look.pitch -= this.dy * this.sensitivity * (this.invertY ? -1 : 1);
    this.look.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.look.pitch));
    this.look.yaw = wrapAngle(this.look.yaw);
    this.dx = 0;
    this.dy = 0;
    return this.look;
  }

  /** Frame-level edge trigger (UI toggles like the debug overlay). Clears on read. */
  consumeFramePress(action: Action): boolean {
    return this.pressedSinceFrame.delete(action);
  }

  /** Builds this tick's command. The returned object is reused: valid until the next call. */
  sampleCommand(): InputCommand {
    const c = this.command;
    const x = (this.held.has('moveRight') ? 1 : 0) - (this.held.has('moveLeft') ? 1 : 0);
    const z = (this.held.has('moveForward') ? 1 : 0) - (this.held.has('moveBack') ? 1 : 0);
    const len = Math.hypot(x, z);
    c.moveX = len > 1 ? x / len : x;
    c.moveZ = len > 1 ? z / len : z;
    c.yaw = this.look.yaw;
    c.pitch = this.look.pitch;
    c.held.clear();
    for (const a of this.held) c.held.add(a);
    c.pressed.clear();
    for (const a of this.pressedSinceTick) c.pressed.add(a);
    this.pressedSinceTick.clear();
    return c;
  }

  private recomputeHeld(): void {
    this.held.clear();
    for (const code of this.downCodes) {
      for (const a of this.codeToActions.get(code) ?? []) this.held.add(a);
    }
  }
}

export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  return a - twoPi * Math.floor((a + Math.PI) / twoPi);
}

/** DOM layer: keyboard + pointer-locked mouse on the game canvas. */
export class Input implements Service {
  readonly name = 'input';
  readonly state: InputState;
  private abort = new AbortController();
  private lockListeners: ((locked: boolean) => void)[] = [];

  constructor(
    private readonly target: HTMLElement,
    bindings: Record<Action, readonly string[]> = DEFAULT_BINDINGS,
  ) {
    this.state = new InputState(bindings);
  }

  init(): void {
    const opts = { signal: this.abort.signal };
    window.addEventListener('keydown', (e) => {
      // Only take keys while playing, so typing in UI (later: name entry) still works.
      if (!this.locked) return;
      if (this.state.keyDown(e.code, e.repeat)) e.preventDefault();
    }, opts);
    window.addEventListener('keyup', (e) => this.state.keyUp(e.code), opts);
    window.addEventListener('blur', () => this.state.releaseAll(), opts);
    document.addEventListener('mousemove', (e) => {
      if (this.locked) this.state.mouseMove(e.movementX, e.movementY);
    }, opts);
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) this.state.releaseAll();
      for (const l of this.lockListeners) l(this.locked);
    }, opts);
  }

  /** True while the pointer is locked to the game canvas. */
  get locked(): boolean {
    return document.pointerLockElement === this.target;
  }

  onLockChange(listener: (locked: boolean) => void): void {
    this.lockListeners.push(listener);
  }

  /** Must be called from a user gesture. Prefers raw (unaccelerated) mouse movement. */
  async requestPointerLock(): Promise<void> {
    try {
      await this.target.requestPointerLock({ unadjustedMovement: true });
    } catch {
      // Not supported (e.g. Firefox): fall back to OS-accelerated movement.
      await this.target.requestPointerLock();
    }
  }

  dispose(): void {
    this.abort.abort();
    if (this.locked) document.exitPointerLock();
  }
}
