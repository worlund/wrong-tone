// The golden path as fixed-step systems, in execution order:
// runClock → interaction → package → doors (ghost wall, knock, answer) → encounter.
// Each reads and writes plain data; sounds, voices and word grades leave as events.

import type { SimSystem } from '../../engine/core/system';
import { Door, FluorescentLight, Interactable, Package, Player, type SignText } from '../components';
import type { GameContext } from '../context';
import { inferGrade } from '../language/wordLog';
import { ANSWER, HUSH, LINES } from '../lines';
import { resetRun } from '../reset';
import { Run, setPhase } from '../run';
import type { ToneNumber } from '../tone/toneInput';

const INTERACT_RANGE = 2.2;
const KNOCK_TIME = 1.3; // seconds of knocking before 谁？
const REASK_AFTER = 12; // seconds of silence before asking again
const OPEN_TIME = 1.8; // seconds for the door to swing open
const HOP_DISTANCE = 1.1; // metres per hop
const HOP_INTERVAL = 0.75;
const GRACE = 1.0; // seconds after lights-out before noise counts
const LOUD_LIMIT = 0.25; // seconds of noise that give you away
const CAUGHT_TIME = 3; // seconds of death screen before the reset

/** Mic level that counts as noise during the encounter, from the measured room baseline. */
export function noiseThresholdDb(baselineDb: number): number {
  return Math.min(-24, Math.max(-50, baselineDb + 14));
}

const run = (ctx: GameContext) => ctx.engine.world.require(ctx.run, Run);
const say = (ctx: GameContext, line: SignText, position?: { x: number; y: number; z: number }) => {
  ctx.engine.events.emit('voice', { ...line, position });
  ctx.tone.muteFor(1.0 + line.hanzi.length * 0.25); // don't hear our own voice line as an answer
};
const exitDoor = (ctx: GameContext) => {
  for (const [e, rt] of ctx.level.doors) if (ctx.engine.world.require(e, Door).role === 'exit') return { e, rt };
  throw new Error('room has no exit door');
};

export function runClockSystem(ctx: GameContext): SimSystem {
  return {
    name: 'runClock',
    fixedUpdate(_w, dt) {
      const r = run(ctx);
      r.time += dt;
      r.phaseTime += dt;
    },
  };
}

/** Finds what the crosshair is on; E on it becomes run.interacted for this tick. F toggles the flashlight. */
export function interactionSystem(ctx: GameContext): SimSystem {
  const dir = { x: 0, y: 0, z: 0 };
  const eye = { x: 0, y: 0, z: 0 };
  return {
    name: 'interaction',
    fixedUpdate(world) {
      const r = run(ctx);
      const p = world.require(ctx.player, Player);
      const c = ctx.engine.command;
      const s = ctx.character.settings;
      const cp = Math.cos(p.pitch);
      dir.x = -Math.sin(p.yaw) * cp;
      dir.y = Math.sin(p.pitch);
      dir.z = -Math.cos(p.yaw) * cp;
      eye.x = p.character.position.x;
      eye.y = p.character.position.y + (p.character.crouching ? s.crouchEyeHeight : s.eyeHeight);
      eye.z = p.character.position.z;

      const isTarget = (h: number) => {
        const e = ctx.level.targets.get(h);
        return e !== undefined && world.require(e, Interactable).prompt !== '';
      };
      const hit = ctx.engine.physics.aimCast(eye, dir, INTERACT_RANGE, isTarget, ctx.character.collider);
      const e = hit ? ctx.level.targets.get(hit.handle) : undefined;
      r.focus = e !== undefined && hit!.distance <= world.require(e, Interactable).range ? e : null;
      r.interacted = r.focus !== null && c.pressed.has('interact') ? r.focus : null;

      if (c.pressed.has('flashlight')) {
        p.flashlight = !p.flashlight;
        ctx.engine.events.emit('sound', { cue: 'click' });
      }
    },
  };
}

/** Pick up the package; hand it over through the open exit door. */
export function packageSystem(ctx: GameContext): SimSystem {
  return {
    name: 'package',
    fixedUpdate(world) {
      const r = run(ctx);
      const p = world.require(ctx.player, Player);
      const e = ctx.level.package.entity;
      const pkg = world.require(e, Package);
      world.require(e, Interactable).prompt = pkg.state === 'shelf' && r.phase === 'explore' ? 'Pick up package' : '';

      if (r.interacted === e && pkg.state === 'shelf') {
        pkg.state = 'carried';
        p.carrying = e;
        r.readStart = r.time;
        ctx.level.package.collider.setEnabled(false);
        ctx.engine.events.emit('sound', { cue: 'pickup' });
      }

      if (r.phase === 'deliver' && p.carrying === e && r.interacted === exitDoor(ctx).e) {
        pkg.state = 'delivered';
        p.carrying = null;
        say(ctx, LINES.thanks, exitDoor(ctx).rt.doorway);
        setPhase(r, 'done');
        ctx.engine.events.emit('delivered', {});
      }
    },
  };
}

/** Sign doors: the decoy is a ghost wall; the exit is knocked on, asks 谁？, and opens to the right tone. */
export function doorsSystem(ctx: GameContext): SimSystem {
  const gradeRead = (correct: boolean) => {
    const r = run(ctx);
    const sign = ctx.engine.world.require(exitDoor(ctx).e, Door).sign;
    const responseTime = r.time - (r.readStart ?? 0);
    ctx.engine.events.emit('word', {
      ...sign, facet: 'read', correct, responseTime, grade: inferGrade(correct, responseTime, 10),
    });
  };

  return {
    name: 'doors',
    fixedUpdate(world, dt) {
      const r = run(ctx);
      const p = world.require(ctx.player, Player);
      const c = ctx.engine.command;

      for (const [e, rt] of ctx.level.doors) {
        const door = world.require(e, Door);
        const it = world.require(e, Interactable);
        it.prompt =
          r.phase === 'explore' ? (door.role === 'exit' ? 'Knock' : 'Open')
          : r.phase === 'deliver' && door.role === 'exit' && p.carrying !== null ? 'Hand over the package'
          : '';

        // The open doorway keeps its collider as an invisible threshold: you hand the package
        // across it, but you don't walk into the dark (and it stays the aim target for delivery).
        if (door.opening && door.open < 1) door.open = Math.min(1, door.open + dt / OPEN_TIME);

        if (r.interacted !== e || r.phase !== 'explore') continue;
        if (door.role === 'decoy') {
          // 鬼打墙: the wrong door loops you back to where you started.
          gradeRead(false);
          r.wrongDoors++;
          ctx.engine.events.emit('sound', { cue: 'doorRattle', position: rt.doorway });
          ctx.engine.events.emit('ghostWall', {});
          ctx.character.teleport(p.character, ctx.level.def.spawn);
          ctx.engine.input.state.look.yaw = ctx.level.def.spawnYaw;
          for (const l of world.query(FluorescentLight)) world.require(l, FluorescentLight).burst = 25;
        } else {
          gradeRead(true);
          setPhase(r, 'knocking');
          ctx.engine.events.emit('sound', { cue: 'knock', position: rt.doorway });
        }
      }

      const exit = exitDoor(ctx);
      if (r.phase === 'knocking' && r.phaseTime >= KNOCK_TIME) {
        say(ctx, LINES.who, exit.rt.doorway);
        setPhase(r, 'asked');
        r.askedFor = 0;
        ctx.tone.setListening(true);
      }

      if (r.phase === 'asked') {
        if (ctx.tone.mode === 'keys') {
          for (const n of [1, 2, 3, 4] as const) if (c.pressed.has(`tone${n}`)) ctx.tone.pushKeyTone(n as ToneNumber);
        }
        r.askedFor += dt;
        const u = ctx.tone.pollUtterance();
        if (u) {
          r.askedFor = 0;
          const syl = u.syllables[0]!;
          const unclear = u.source === 'mic' && Math.max(...syl.probs) < 0.4;
          if (unclear) {
            say(ctx, LINES.what, exit.rt.doorway); // ungraded: we couldn't tell
          } else {
            // Lenient, like tone-lab's judge(): top guess, or at least 35% for the target tone.
            const correct = syl.tone === ANSWER.tone || (u.source === 'mic' && syl.probs[ANSWER.tone - 1]! >= 0.35);
            ctx.engine.events.emit('word', {
              hanzi: ANSWER.hanzi, pinyin: ANSWER.pinyin, meaning: ANSWER.meaning, facet: 'speak', correct,
              responseTime: r.phaseTime, grade: inferGrade(correct, r.phaseTime, 8),
              speech: { target: ANSWER.tone, heard: syl.tone, probs: syl.probs, contour: syl.contour, source: u.source },
            });
            if (correct) {
              say(ctx, LINES.itsYou, exit.rt.doorway);
              ctx.tone.setListening(false);
              world.require(exit.e, Door).opening = true;
              ctx.engine.events.emit('sound', { cue: 'creak', position: exit.rt.doorway });
              setPhase(r, 'opening');
            } else {
              r.wrongTones++;
              say(ctx, LINES.what, exit.rt.doorway);
            }
          }
        } else if (r.askedFor > REASK_AFTER) {
          r.askedFor = 0;
          say(ctx, LINES.who, exit.rt.doorway);
        }
      }
    },
  };
}

/** Lights die, something hops closer; stay quiet (or, without a mic, stay still). */
export function encounterSystem(ctx: GameContext): SimSystem {
  const hush = (correct: boolean) => {
    const r = run(ctx);
    ctx.engine.events.emit('word', {
      ...HUSH, facet: 'silence', correct, responseTime: r.phaseTime, grade: correct ? 'good' : 'again',
    });
  };

  return {
    name: 'encounter',
    fixedUpdate(world, dt) {
      const r = run(ctx);
      const exit = exitDoor(ctx);

      if (r.phase === 'opening') {
        // Measure how loud the room is with the player waiting, to set the noise threshold.
        r.quietBaselineDb = r.phaseTime <= dt ? ctx.tone.levelDb : r.quietBaselineDb * 0.95 + ctx.tone.levelDb * 0.05;
        if (world.require(exit.e, Door).open >= 1) {
          setPhase(r, 'encounter');
          r.blackout = true;
          r.monsterDistance = 9;
          r.nextHop = GRACE;
          r.loudFor = 0;
          ctx.engine.events.emit('sound', { cue: 'lightsOut' });
        }
        return;
      }

      if (r.phase === 'encounter') {
        r.nextHop -= dt;
        if (r.nextHop <= 0) {
          r.monsterDistance -= HOP_DISTANCE;
          r.nextHop = HOP_INTERVAL;
          const d = exit.rt.doorway;
          ctx.engine.events.emit('sound', { cue: 'hop', position: { x: d.x, y: 0.2, z: d.z - Math.max(0.5, r.monsterDistance) } });
        }
        if (r.phaseTime > GRACE) {
          const c = ctx.engine.command;
          const noisy = ctx.tone.mode === 'mic'
            ? ctx.tone.levelDb > noiseThresholdDb(r.quietBaselineDb)
            : c.moveX !== 0 || c.moveZ !== 0 || c.held.has('jump') || c.held.has('sprint');
          r.loudFor = noisy ? r.loudFor + dt : Math.max(0, r.loudFor - 2 * dt);
          if (r.loudFor > LOUD_LIMIT) {
            setPhase(r, 'caught');
            r.caught++;
            hush(false);
            ctx.engine.events.emit('sound', { cue: 'caughtSting' });
            ctx.engine.events.emit('caught', {});
            return;
          }
        }
        if (r.monsterDistance <= 0.6) {
          // It reached the doorway, listened, and moved on.
          r.blackout = false;
          hush(true);
          ctx.engine.events.emit('sound', { cue: 'retreat', position: exit.rt.doorway });
          for (const l of world.query(FluorescentLight)) world.require(l, FluorescentLight).burst = 40;
          setPhase(r, 'deliver');
        }
        return;
      }

      if (r.phase === 'caught' && r.phaseTime >= CAUGHT_TIME) resetRun(ctx);
    },
  };
}
