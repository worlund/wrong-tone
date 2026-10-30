// Movement feel and light flicker, with real Rapier physics and the real systems.
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/engine/core/events';
import { InputState } from '../../src/engine/input/input';
import { Physics } from '../../src/engine/physics/physics';
import { CharacterBody, DEFAULT_CHARACTER } from '../../src/engine/physics/character';
import { World } from '../../src/engine/world/world';
import { FluorescentLight, Player } from '../../src/game/components';
import type { GameContext } from '../../src/game/context';
import type { GameEvents } from '../../src/game/events';
import { movementSystem } from '../../src/game/systems/movement';
import { lightsSimSystem } from '../../src/game/systems/lights';

const DT = 1 / 60;

async function setup() {
  const physics = new Physics();
  await physics.init();
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 50, y: 0.5, z: 50 });
  const world = new World();
  const input = new InputState();
  const events = new EventBus<GameEvents>();
  const character = new CharacterBody(physics);
  const player = world.createEntity();
  world.add(player, Player, {
    character: character.spawn({ x: 0, y: 0.05, z: 0 }),
    yaw: 0, pitch: 0, stamina: 1, sprintLocked: false, sprinting: false, jumpBuffer: 0, stride: 0, carrying: null, flashlight: false,
  });
  const engine = { command: input.sampleCommand(), events, physics, world };
  const ctx = { engine, character, player } as unknown as GameContext;
  const system = movementSystem(ctx);
  const sounds: string[] = [];
  events.on('sound', (e) => sounds.push(e.cue));
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      engine.command = input.sampleCommand();
      system.fixedUpdate(world, DT, 0);
      physics.step(DT);
    }
  };
  // Settle onto the floor.
  tick(20);
  const p = () => world.require(player, Player);
  const speed = () => Math.hypot(p().character.velocity.x, p().character.velocity.z);
  return { input, tick, p, speed, sounds };
}

describe('player movement', () => {
  it('reaches walk speed within the acceleration time and stops faster than it starts', async () => {
    const t = await setup();
    t.input.keyDown('KeyW');
    t.tick(Math.ceil(DEFAULT_CHARACTER.accelTime / DT) + 1);
    expect(t.speed()).toBeCloseTo(DEFAULT_CHARACTER.walkSpeed, 1);
    expect(t.p().character.velocity.z).toBeLessThan(0); // yaw 0 = forward is -Z
    t.input.keyUp('KeyW');
    t.tick(Math.ceil(DEFAULT_CHARACTER.decelTime / DT) + 1);
    expect(t.speed()).toBeLessThan(0.05);
  });

  it('sprints only forward, and locks sprint when stamina runs out', async () => {
    const t = await setup();
    t.input.keyDown('ShiftLeft');
    t.input.keyDown('KeyS'); // backwards: no sprint
    t.tick(30);
    expect(t.speed()).toBeCloseTo(DEFAULT_CHARACTER.walkSpeed, 1);
    t.input.keyUp('KeyS');
    t.input.keyDown('KeyW');
    t.tick(30);
    expect(t.speed()).toBeCloseTo(DEFAULT_CHARACTER.sprintSpeed, 1);
    let ticks = 0;
    while (!t.p().sprintLocked && ticks < 60 * 10) { t.tick(1); ticks++; }
    expect(ticks / 60).toBeGreaterThan(4); // a full bar lasts ~4.5 s
    t.tick(10);
    expect(t.speed()).toBeCloseTo(DEFAULT_CHARACTER.walkSpeed, 1); // locked out: walking
    while (t.p().sprintLocked) t.tick(1);
    expect(t.p().stamina).toBeGreaterThan(0.29); // unlocks only after recovering past 0.3 (minus this tick's drain)
  });

  it('crouches to crouch speed', async () => {
    const t = await setup();
    t.input.keyDown('KeyC');
    t.input.keyDown('KeyW');
    t.tick(30);
    expect(t.p().character.crouching).toBe(true);
    expect(t.speed()).toBeCloseTo(DEFAULT_CHARACTER.crouchSpeed, 1);
  });

  it('jumps from a buffered press made just before landing', async () => {
    const t = await setup();
    t.input.keyDown('Space');
    t.tick(1);
    t.input.keyUp('Space');
    expect(t.p().character.velocity.y).toBeGreaterThan(0);
    // Wait until falling and about to land, press jump early, expect a second jump on landing.
    while (t.p().character.velocity.y > -3.5) t.tick(1);
    t.input.keyDown('Space');
    t.tick(1);
    t.input.keyUp('Space');
    let jumpedAgain = false;
    for (let i = 0; i < 20 && !jumpedAgain; i++) {
      t.tick(1);
      jumpedAgain = t.p().character.velocity.y > 2;
    }
    expect(jumpedAgain).toBe(true);
  });

  it('emits footstep sounds at a walking cadence', async () => {
    const t = await setup();
    t.input.keyDown('KeyW');
    t.tick(120); // 2 s at 3.2 m/s ≈ 6.4 m → about 8 steps of 0.75 m
    const steps = t.sounds.filter((s) => s === 'footstep').length;
    expect(steps).toBeGreaterThanOrEqual(7);
    expect(steps).toBeLessThanOrEqual(10);
  });
});

describe('fluorescent flicker', () => {
  function runLights(flicker: number, ticks: number) {
    const world = new World();
    const e = world.createEntity();
    world.add(e, FluorescentLight, { baseIntensity: 1, flicker, level: 1, burst: 0, seed: 42 });
    const sys = lightsSimSystem();
    const levels: number[] = [];
    for (let t = 0; t < ticks; t++) {
      sys.fixedUpdate(world, DT, t);
      levels.push(world.require(e, FluorescentLight).level);
    }
    return levels;
  }

  it('keeps a steady light steady', () => {
    expect(new Set(runLights(0, 600))).toEqual(new Set([1]));
  });

  it('flickers a broken light with dark moments, identically on every run', () => {
    const a = runLights(0.6, 60 * 30);
    expect(a.some((l) => l < 0.2)).toBe(true);
    expect(a.filter((l) => l > 0.9).length / a.length).toBeGreaterThan(0.7); // mostly on
    expect(runLights(0.6, 60 * 30)).toEqual(a); // deterministic: co-op clients agree
  });
});
