// What gameplay systems share. Built once in main.ts, passed to system factories.

import type { Engine } from '../engine/engine';
import type { CharacterBody } from '../engine/physics/character';
import type { Entity } from '../engine/world/world';
import type { GameEvents } from './events';
import type { GameFlow } from './flow';
import type { Level } from './levels/build';
import type { WordLog } from './language/wordLog';
import type { ToneInput } from './tone/toneInput';

export interface GameSettings {
  headBob: boolean;
  /** Extra field of view while sprinting, in degrees. */
  sprintFovKick: number;
}

export interface GameContext {
  engine: Engine<GameEvents>;
  flow: GameFlow;
  character: CharacterBody;
  player: Entity;
  /** Singleton entity holding the Run component. */
  run: Entity;
  level: Level;
  tone: ToneInput;
  words: WordLog;
  settings: GameSettings;
}
