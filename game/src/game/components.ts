// Gameplay components: plain data only (no Three.js objects), so the world can be
// snapshotted for co-op. Visuals are looked up from the entity id by frame systems.

import { defineComponent } from '../engine/world/world';
import type { CharacterState } from '../engine/physics/character';

export interface Player {
  character: CharacterState;
  /** Look direction for this tick, copied from the input command. */
  yaw: number;
  pitch: number;
  /** 0..1; sprinting drains it. Hitting 0 locks sprint until it recovers past 0.3. */
  stamina: number;
  sprintLocked: boolean;
  sprinting: boolean;
  /** Seconds left in which a recent jump press still triggers a jump on landing. */
  jumpBuffer: number;
  /** Distance walked since the last footstep sound. */
  stride: number;
  carrying: number | null; // entity id of a held item
  flashlight: boolean;
}

export interface Interactable {
  /** Shown under the crosshair, e.g. "Pick up package". Empty = not interactable right now. */
  prompt: string;
  /** Max distance in metres from the eye. */
  range: number;
}

export interface SignText {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

/** A door on the far wall. Exactly one per room is the exit; its side is randomised per run. */
export interface Door {
  role: 'exit' | 'decoy';
  sign: SignText;
  /** 0 closed … 1 fully open; animated by the doors system. */
  open: number;
  opening: boolean;
}

export interface Package {
  state: 'shelf' | 'carried' | 'delivered';
}

export interface FluorescentLight {
  baseIntensity: number;
  flicker: number; // 0 steady … 1 broken
  /** Current output 0..1, set by the lights system each tick. */
  level: number;
  /** Ticks left in the current flicker burst. */
  burst: number;
  seed: number;
}

export const Player = defineComponent<Player>('Player');
export const Interactable = defineComponent<Interactable>('Interactable');
export const Door = defineComponent<Door>('Door');
export const Package = defineComponent<Package>('Package');
export const FluorescentLight = defineComponent<FluorescentLight>('FluorescentLight');
