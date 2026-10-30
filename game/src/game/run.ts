// State of one attempt at the room (a "run"), as plain data on a singleton entity.
// The golden path is a phase machine: explore → knocking → asked → opening →
// encounter → deliver → done, with 'caught' as the failure branch.

import { defineComponent, type Entity } from '../engine/world/world';

export type RunPhase =
  | 'explore' // steps 3–4: find the package, read the doors
  | 'knocking' // step 5: knock animation and sound
  | 'asked' // step 5: 谁？ was asked, listening for the answer
  | 'opening' // step 5→6: the door swings open, ambient level is measured
  | 'encounter' // step 6: lights out, it approaches; stay quiet
  | 'deliver' // step 7: hand the package through the door
  | 'done' // step 8: report
  | 'caught'; // step 6 failure: death replay, then reset

export interface Run {
  phase: RunPhase;
  /** Seconds since the run started / since the current phase started. */
  time: number;
  phaseTime: number;
  /** Interactable under the crosshair this tick, and the one E was pressed on. */
  focus: Entity | null;
  interacted: Entity | null;
  /** When the player picked up the package: reading time is measured from here. */
  readStart: number | null;
  /** Lights forced off by the encounter. */
  blackout: boolean;
  /** The thing behind the door: distance from the doorway (m) and time to its next hop. */
  monsterDistance: number;
  nextHop: number;
  /** Mic level baseline (dBFS) measured while the door opens; the threshold sits above it. */
  quietBaselineDb: number;
  loudFor: number;
  /** Seconds the current question has gone unanswered. */
  askedFor: number;
  wrongDoors: number;
  wrongTones: number;
  caught: number;
}

export const Run = defineComponent<Run>('Run');

export function freshRun(previous?: Run): Run {
  return {
    phase: 'explore',
    time: 0,
    phaseTime: 0,
    focus: null,
    interacted: null,
    readStart: null,
    blackout: false,
    monsterDistance: 0,
    nextHop: 0,
    quietBaselineDb: -60,
    loudFor: 0,
    askedFor: 0,
    // Mistake counters survive a reset: the report covers the whole shift.
    wrongDoors: previous?.wrongDoors ?? 0,
    wrongTones: previous?.wrongTones ?? 0,
    caught: previous?.caught ?? 0,
  };
}

export function setPhase(run: Run, phase: RunPhase): void {
  run.phase = phase;
  run.phaseTime = 0;
}
