// The golden path with the real systems and real Rapier physics, on a minimal stand-in level
// (the real level builder needs a DOM for canvas textures).
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/engine/core/events';
import { InputState } from '../../src/engine/input/input';
import { Physics } from '../../src/engine/physics/physics';
import { CharacterBody } from '../../src/engine/physics/character';
import { World, type Entity } from '../../src/engine/world/world';
import { Door, FluorescentLight, Interactable, Package, Player } from '../../src/game/components';
import type { GameContext } from '../../src/game/context';
import type { GameEvents } from '../../src/game/events';
import { WordLog } from '../../src/game/language/wordLog';
import type { DoorRuntime, Level } from '../../src/game/levels/build';
import { ROOM_01 } from '../../src/game/levels/room01';
import { freshRun, Run } from '../../src/game/run';
import { resetRun } from '../../src/game/reset';
import { simSystems } from '../../src/game/systems';
import { noiseThresholdDb } from '../../src/game/systems/goldenPath';
import type { ToneInput, ToneNumber, Utterance } from '../../src/game/tone/toneInput';

const DT = 1 / 60;

/** Scriptable tone input: tests push utterances and set the mic level. */
function fakeTone(mode: 'mic' | 'keys') {
  const queue: Utterance[] = [];
  let listening = false;
  const t: ToneInput & { levelDb: number; listening: () => boolean; say(tone: ToneNumber, top?: number): void } = {
    mode,
    levelDb: -60,
    requestMic: () => Promise.resolve(mode),
    setListening: (on) => { listening = on; },
    muteFor: () => {},
    pushKeyTone: (tone) => listening && queue.push({ syllables: [{ tone, probs: [0, 0, 0, 0].map((_, i) => (i === tone - 1 ? 1 : 0)) as [number, number, number, number], contour: [] }], durationSec: 0, source: 'keys' }),
    pollUtterance: () => queue.shift() ?? null,
    dispose: () => {},
    listening: () => listening,
    say(tone, top = 0.8) {
      const probs = [0.1, 0.1, 0.1, 0.1] as [number, number, number, number];
      probs[tone - 1] = top;
      if (listening) queue.push({ syllables: [{ tone, probs, contour: [0, -1, -2, -1, 0] }], durationSec: 0.4, source: 'mic' });
    },
  };
  return t;
}

async function setup(mode: 'mic' | 'keys' = 'mic') {
  const physics = new Physics();
  await physics.init();
  const world = new World();
  const events = new EventBus<GameEvents>();
  const input = new InputState();
  const { width: W, depth: D } = ROOM_01.size;
  physics.addStaticBox({ x: 0, y: -0.1, z: 0 }, { x: W / 2, y: 0.1, z: D / 2 + 3 });

  // Doors: colliders at the real slots, plus entities like the builder makes.
  const doors = new Map<Entity, DoorRuntime>();
  const targets = new Map<number, Entity>();
  ROOM_01.signDoors.forEach((d, slot) => {
    const collider = physics.addStaticBox({ x: d.x, y: 1.05, z: -D / 2 - 0.06 }, { x: d.width / 2, y: 1.05, z: 0.05 });
    const e = world.createEntity();
    world.add(e, Door, { role: 'decoy', sign: { hanzi: '', pinyin: '', meaning: '' }, open: 0, opening: false });
    world.add(e, Interactable, { prompt: '', range: 2.2 });
    targets.set(collider.handle, e);
    doors.set(e, { slot, collider, pivot: null!, doorway: { x: d.x, y: 0, z: -D / 2 }, sign: null! });
  });
  const s = ROOM_01.packageShelf;
  const pkgCollider = physics.addStaticBox({ x: s.x, y: s.y + 0.12, z: s.z }, { x: 0.17, y: 0.12, z: 0.15 });
  const pkg = world.createEntity();
  world.add(pkg, Package, { state: 'shelf' });
  world.add(pkg, Interactable, { prompt: '', range: 2.2 });
  targets.set(pkgCollider.handle, pkg);
  const light = world.createEntity();
  world.add(light, FluorescentLight, { baseIntensity: 1, flicker: 0, level: 1, burst: 0, seed: 1 });

  let exitSlot = 0;
  const level = {
    def: ROOM_01, doors, targets,
    package: { entity: pkg, mesh: null!, collider: pkgCollider },
    assignDoors(slot: number) {
      exitSlot = slot;
      for (const [e, rt] of doors) {
        const door = world.require(e, Door);
        door.role = rt.slot === slot ? 'exit' : 'decoy';
        door.sign = door.role === 'exit' ? ROOM_01.signPairs[0]!.correct : ROOM_01.signPairs[0]!.distractor;
      }
    },
  } as unknown as Level;

  const character = new CharacterBody(physics);
  const player = world.createEntity();
  world.add(player, Player, {
    character: character.spawn(ROOM_01.spawn), yaw: 0, pitch: 0, stamina: 1, sprintLocked: false,
    sprinting: false, jumpBuffer: 0, stride: 0, carrying: null, flashlight: false,
  });
  const run = world.createEntity();
  world.add(run, Run, freshRun());
  const tone = fakeTone(mode);
  const words = new WordLog();
  words.listen(events);
  const engine = { command: input.sampleCommand(), events, physics, world, input: { state: input } };
  const ctx = { engine, character, player, run, level, tone, words } as unknown as GameContext;
  const systems = simSystems(ctx);
  level.assignDoors(0);

  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      engine.command = input.sampleCommand();
      systems.forEach((sys, k) => sys.fixedUpdate(world, DT, k));
      physics.step(DT);
    }
  };
  const seconds = (s: number) => tick(Math.round(s / DT));
  const r = () => world.require(run, Run);
  const p = () => world.require(player, Player);
  const voices: string[] = [];
  const sounds: string[] = [];
  events.on('voice', (v) => voices.push(v.hanzi));
  events.on('sound', (v) => sounds.push(v.cue));

  /** Puts the player in front of a point and aims at it. */
  const aimAt = (x: number, y: number, z: number, standOff = 1.2) => {
    const ch = p().character;
    character.teleport(ch, { x, y: 0.05, z: z + standOff });
    tick(3);
    const eyeY = ch.position.y + character.settings.eyeHeight;
    input.look.yaw = 0;
    input.look.pitch = Math.atan2(y - eyeY, standOff);
  };
  const press = (code: string) => { input.keyDown(code); tick(1); input.keyUp(code); tick(1); };
  const door = (role: 'exit' | 'decoy') => [...doors].find(([e]) => world.require(e, Door).role === role)!;
  const interactWithDoor = (role: 'exit' | 'decoy') => {
    const [, rt] = door(role);
    aimAt(rt.doorway.x, 1.1, rt.doorway.z - 0.06);
    press('KeyE');
  };
  const pickUp = () => { aimAt(s.x, s.y + 0.12, s.z, 0); character.teleport(p().character, { x: s.x - 1.2, y: 0.05, z: s.z }); tick(3); input.look.yaw = -Math.PI / 2; input.look.pitch = -0.35; press('KeyE'); };
  return { ctx, world, input, tick, seconds, r, p, tone, words, voices, sounds, aimAt, press, door, interactWithDoor, pickUp, getExitSlot: () => exitSlot, character };
}

describe('interaction', () => {
  it('focuses the interactable under the crosshair within its range', async () => {
    const t = await setup();
    const [e, rt] = t.door('exit');
    t.aimAt(rt.doorway.x, 1.1, rt.doorway.z);
    expect(t.r().focus).toBe(e);
    t.aimAt(rt.doorway.x, 1.1, rt.doorway.z, 4); // too far away
    expect(t.r().focus).toBe(null);
  });

  it('forgives slightly-off aim (sphere cast), but not looking away', async () => {
    const t = await setup();
    const [e, rt] = t.door('exit');
    // Aim just past the door's edge.
    t.aimAt(rt.doorway.x + 0.5 + 0.05, 1.1, rt.doorway.z);
    expect(t.r().focus).toBe(e);
    t.input.look.yaw = Math.PI / 2; // look at the side wall instead
    t.tick(2);
    expect(t.r().focus).not.toBe(e);
  });

  it('reports the focused entity as interacted only on the tick E is pressed', async () => {
    const t = await setup();
    t.interactWithDoor('exit');
    expect(t.r().phase).toBe('knocking');
    t.tick(5);
    expect(t.r().interacted).toBe(null);
  });
});

describe('package', () => {
  it('is picked up from the shelf and starts the reading timer', async () => {
    const t = await setup();
    t.seconds(1);
    t.pickUp();
    expect(t.p().carrying).toBe(t.ctx.level.package.entity);
    expect(t.r().readStart).toBeGreaterThan(0.9);
    expect(t.sounds).toContain('pickup');
  });
});

describe('sign doors', () => {
  it('puts the exit behind a randomised side each run', async () => {
    const t = await setup();
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      resetRun(t.ctx);
      seen.add(t.getExitSlot());
    }
    expect(seen).toEqual(new Set([0, 1]));
  });

  it('wrong door: ghost wall sends the player back to spawn and logs read = again', async () => {
    const t = await setup();
    t.interactWithDoor('decoy');
    const pos = t.p().character.position;
    expect(Math.hypot(pos.x - ROOM_01.spawn.x, pos.z - ROOM_01.spawn.z)).toBeLessThan(0.1);
    expect(t.r().phase).toBe('explore');
    expect(t.r().wrongDoors).toBe(1);
    expect(t.words.events[0]).toMatchObject({ hanzi: '出口', facet: 'read', correct: false, grade: 'again' });
  });

  it('exit door: starts the knock sequence and logs read = good', async () => {
    const t = await setup();
    t.interactWithDoor('exit');
    expect(t.r().phase).toBe('knocking');
    expect(t.sounds).toContain('knock');
    expect(t.words.events[0]).toMatchObject({ hanzi: '出口', facet: 'read', correct: true, grade: 'good' });
  });

  it('only the first door decision is graded', async () => {
    const t = await setup();
    t.interactWithDoor('decoy');
    t.interactWithDoor('exit');
    expect(t.words.events.map((e) => e.first)).toEqual([true, false]);
  });
});

describe('knock and answer', () => {
  it('asks 谁？ after the knock and starts listening', async () => {
    const t = await setup();
    t.interactWithDoor('exit');
    t.seconds(1.4);
    expect(t.voices).toEqual(['谁？']);
    expect(t.r().phase).toBe('asked');
    expect(t.tone.listening()).toBe(true);
  });

  it('opens on a third tone (我) and logs speak = good', async () => {
    const t = await setup();
    t.interactWithDoor('exit');
    t.seconds(1.4);
    t.tone.say(3);
    t.tick(1);
    expect(t.r().phase).toBe('opening');
    expect(t.tone.listening()).toBe(false);
    const spoken = t.words.events.find((e) => e.facet === 'speak')!;
    expect(spoken).toMatchObject({ hanzi: '我', correct: true, grade: 'good' });
    expect(spoken.speech).toMatchObject({ target: 3, heard: 3, source: 'mic' });
  });

  it('answers 什么？ to a wrong tone, counts it, and keeps listening', async () => {
    const t = await setup();
    t.interactWithDoor('exit');
    t.seconds(1.4);
    t.tone.say(4);
    t.tick(1);
    expect(t.voices.at(-1)).toBe('什么？');
    expect(t.r().phase).toBe('asked');
    expect(t.r().wrongTones).toBe(1);
    expect(t.words.events.at(-1)).toMatchObject({ facet: 'speak', correct: false, grade: 'again' });
  });

  it('ignores unclear utterances without grading them', async () => {
    const t = await setup();
    t.interactWithDoor('exit');
    t.seconds(1.4);
    t.tone.say(4, 0.3); // top guess only 30%
    t.tick(1);
    expect(t.voices.at(-1)).toBe('什么？');
    expect(t.words.events.filter((e) => e.facet === 'speak')).toHaveLength(0);
  });

  it('re-asks after a long silence', async () => {
    const t = await setup();
    t.interactWithDoor('exit');
    t.seconds(1.4 + 12.2);
    expect(t.voices).toEqual(['谁？', '谁？']);
  });

  it('accepts the 1–4 keys when there is no microphone', async () => {
    const t = await setup('keys');
    t.interactWithDoor('exit');
    t.seconds(1.4);
    t.press('Digit3');
    expect(t.r().phase).toBe('opening');
    expect(t.words.events.find((e) => e.facet === 'speak')!.speech!.source).toBe('keys');
  });
});

async function toEncounter(mode: 'mic' | 'keys' = 'mic') {
  const t = await setup(mode);
  t.pickUp();
  t.interactWithDoor('exit');
  t.seconds(1.4);
  if (mode === 'mic') t.tone.say(3); else t.press('Digit3');
  t.seconds(2); // the door swings open
  return t;
}

describe('silence encounter', () => {
  it('turns the lights off and brings the thing closer hop by hop', async () => {
    const t = await toEncounter();
    expect(t.r().phase).toBe('encounter');
    expect(t.r().blackout).toBe(true);
    t.tick(1);
    expect(t.world.require(t.world.query(FluorescentLight)[0]!, FluorescentLight).level).toBe(0);
    const before = t.r().monsterDistance;
    t.seconds(2);
    expect(t.r().monsterDistance).toBeLessThan(before);
    expect(t.sounds.filter((s) => s === 'hop').length).toBeGreaterThanOrEqual(2);
  });

  it('catches a player who is loud for longer than a moment', async () => {
    const t = await toEncounter();
    t.seconds(1.2);
    t.tone.levelDb = noiseThresholdDb(t.r().quietBaselineDb) + 6;
    t.seconds(0.1);
    expect(t.r().phase).toBe('encounter'); // a click or breath doesn't count
    t.seconds(0.3);
    expect(t.r().phase).toBe('caught');
    expect(t.words.events.at(-1)).toMatchObject({ hanzi: '嘘', facet: 'silence', correct: false });
  });

  it('without a mic, catches a player who moves instead', async () => {
    const t = await toEncounter('keys');
    t.seconds(1.2);
    t.input.keyDown('KeyW');
    t.seconds(0.4);
    expect(t.r().phase).toBe('caught');
  });

  it('lets a quiet player through, then the lights return', async () => {
    const t = await toEncounter();
    t.seconds(10);
    expect(t.r().phase).toBe('deliver');
    expect(t.r().blackout).toBe(false);
    expect(t.words.events.at(-1)).toMatchObject({ hanzi: '嘘', correct: true });
  });
});

describe('delivery and reset', () => {
  it('delivers the carried package through the open door and ends the run', async () => {
    const t = await toEncounter();
    t.seconds(10);
    t.interactWithDoor('exit');
    expect(t.r().phase).toBe('done');
    expect(t.world.require(t.ctx.level.package.entity, Package).state).toBe('delivered');
    expect(t.voices.at(-1)).toBe('谢谢。');
  });

  it('after being caught, resets the room but keeps the shift statistics', async () => {
    const t = await toEncounter();
    t.seconds(1.2);
    t.tone.levelDb = -10;
    t.seconds(0.5);
    expect(t.r().phase).toBe('caught');
    t.seconds(3.2);
    expect(t.r().phase).toBe('explore');
    expect(t.r().caught).toBe(1);
    expect(t.p().carrying).toBe(null);
    expect(t.world.require(t.ctx.level.package.entity, Package).state).toBe('shelf');
    for (const [e] of t.ctx.level.doors) expect(t.world.require(e, Door).open).toBe(0);
  });
});
