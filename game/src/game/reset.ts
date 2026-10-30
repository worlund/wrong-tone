// Puts the room back to the start of the golden path (after being caught, or "play again").
// The shift's mistake counters and the word log are kept.

import { Door, FluorescentLight, Package, Player } from './components';
import type { GameContext } from './context';
import { freshRun, Run } from './run';

export interface ResetOptions {
  random?: () => number;
  /** A new shift also clears the mistake counters and the word log (after the report). */
  newShift?: boolean;
}

export function resetRun(ctx: GameContext, { random = Math.random, newShift = false }: ResetOptions = {}): void {
  const { world } = ctx.engine;
  const def = ctx.level.def;
  world.add(ctx.run, Run, freshRun(newShift ? undefined : world.get(ctx.run, Run)));
  if (newShift) ctx.words.clear();

  const p = world.require(ctx.player, Player);
  ctx.character.setCrouch(p.character, false);
  ctx.character.teleport(p.character, def.spawn);
  p.carrying = null;
  p.flashlight = false;
  p.stamina = 1;
  p.sprintLocked = false;
  ctx.engine.input.state.look.yaw = def.spawnYaw;
  ctx.engine.input.state.look.pitch = 0;

  world.require(ctx.level.package.entity, Package).state = 'shelf';
  ctx.level.package.collider.setEnabled(true);

  for (const [e, rt] of ctx.level.doors) {
    const door = world.require(e, Door);
    door.open = 0;
    door.opening = false;
    rt.collider.setEnabled(true);
  }
  ctx.level.assignDoors(Math.floor(random() * ctx.level.doors.size));

  for (const l of world.query(FluorescentLight)) world.require(l, FluorescentLight).burst = 0;
  ctx.tone.setListening(false);
  ctx.engine.events.emit('runReset', {});
}
