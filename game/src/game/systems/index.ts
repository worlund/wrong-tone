// Gameplay systems in execution order.

import type { FrameSystem, SimSystem } from '../../engine/core/system';
import type { GameContext } from '../context';
import { gameAudio } from '../audio/sounds';
import { Run } from '../run';
import { cameraSystem } from './camera';
import { doorsSystem, encounterSystem, interactionSystem, packageSystem, runClockSystem } from './goldenPath';
import { lightsFrameSystem, lightsSimSystem } from './lights';
import { movementSystem } from './movement';
import { doorVisualsSystem, flashlightSystem, packageVisualsSystem } from './visuals';

export interface GameSystems {
  sim: SimSystem[];
  frame: FrameSystem[];
  audio: ReturnType<typeof gameAudio>;
}

export function simSystems(ctx: GameContext): SimSystem[] {
  return [
    runClockSystem(ctx),
    movementSystem(ctx),
    interactionSystem(ctx),
    packageSystem(ctx),
    doorsSystem(ctx),
    encounterSystem(ctx),
    lightsSimSystem(() => ctx.engine.world.require(ctx.run, Run).blackout),
  ];
}

export function createSystems(ctx: GameContext): GameSystems {
  const audio = gameAudio(ctx);
  return {
    sim: simSystems(ctx),
    frame: [
      cameraSystem(ctx),
      lightsFrameSystem(ctx),
      doorVisualsSystem(ctx),
      packageVisualsSystem(ctx),
      flashlightSystem(ctx),
      audio,
    ],
    audio,
  };
}
