// Top-level game flow as an explicit state machine. Each state maps to a golden-path step.

export type FlowState =
  | 'loading' // 1. renderer + physics start-up
  | 'start' // 2. click to start: pointer lock, audio unlock, mic permission
  | 'playing' // 3–7. in the room
  | 'caught' // 6. death replay, then back to 'playing' at the checkpoint
  | 'report'; // 8. incident report, then play again

const TRANSITIONS: Record<FlowState, readonly FlowState[]> = {
  loading: ['start'],
  start: ['playing'],
  playing: ['caught', 'report', 'start'], // 'start' = paused / lost pointer lock
  caught: ['playing'],
  report: ['playing'],
};

export class GameFlow {
  state: FlowState = 'loading';
  private listeners: ((to: FlowState, from: FlowState) => void)[] = [];

  canGo(to: FlowState): boolean {
    return TRANSITIONS[this.state].includes(to);
  }

  go(to: FlowState): void {
    if (!this.canGo(to)) throw new Error(`Invalid flow transition ${this.state} → ${to}`);
    const from = this.state;
    this.state = to;
    for (const l of this.listeners) l(to, from);
  }

  onChange(listener: (to: FlowState, from: FlowState) => void): void {
    this.listeners.push(listener);
  }
}
