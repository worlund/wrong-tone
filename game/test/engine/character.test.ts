// Real Rapier (WASM) in Node: the character against actual collision geometry.
import { beforeAll, describe, expect, it } from 'vitest';
import { Physics } from '../../src/engine/physics/physics';
import { CharacterBody, DEFAULT_CHARACTER, type CharacterState } from '../../src/engine/physics/character';

const DT = 1 / 60;

async function setup(build: (p: Physics) => void, at = { x: 0, y: 0.05, z: 0 }) {
  const physics = new Physics();
  await physics.init();
  physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: 20, y: 0.5, z: 20 }); // floor, top at y=0
  build(physics);
  const body = new CharacterBody(physics);
  const state = body.spawn(at);
  physics.step(DT);
  return { physics, body, state };
}

function run(ctx: { physics: Physics; body: CharacterBody; state: CharacterState }, seconds: number, vx = 0, vz = 0) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    ctx.state.velocity.x = vx;
    ctx.state.velocity.z = vz;
    ctx.body.move(ctx.state, DT);
    ctx.physics.step(DT);
  }
}

beforeAll(async () => {
  await new Physics().init(); // warm the WASM once
});

describe('CharacterBody', () => {
  it('falls onto the floor and becomes grounded', async () => {
    const ctx = await setup(() => {}, { x: 0, y: 2, z: 0 });
    run(ctx, 1.5);
    expect(ctx.state.grounded).toBe(true);
    expect(ctx.state.position.y).toBeGreaterThan(-0.01);
    expect(ctx.state.position.y).toBeLessThan(DEFAULT_CHARACTER.skin + 0.02);
  });

  it('stops at a wall instead of passing through, and loses the blocked speed', async () => {
    // Wall face at z = -2.75.
    const ctx = await setup((p) => p.addStaticBox({ x: 0, y: 1, z: -3 }, { x: 5, y: 1, z: 0.25 }));
    run(ctx, 3, 0, -3);
    const expected = -2.75 + DEFAULT_CHARACTER.radius + DEFAULT_CHARACTER.skin;
    expect(ctx.state.position.z).toBeGreaterThan(expected - 0.02);
    expect(ctx.state.position.z).toBeLessThan(expected + 0.02);
    expect(Math.abs(ctx.state.velocity.z)).toBeLessThan(0.5);
  });

  it('slides along a wall when walking into it at an angle', async () => {
    const ctx = await setup((p) => p.addStaticBox({ x: 0, y: 1, z: -1 }, { x: 5, y: 1, z: 0.25 }));
    run(ctx, 1, 2, -2);
    expect(ctx.state.position.x).toBeGreaterThan(1.5);
  });

  it('steps up a 20 cm stair but not onto a 50 cm ledge', async () => {
    const stair = await setup((p) => p.addStaticBox({ x: 0, y: 0.1, z: -3 }, { x: 2, y: 0.1, z: 2 }));
    run(stair, 2, 0, -2);
    expect(stair.state.position.y).toBeGreaterThan(0.15);

    const ledge = await setup((p) => p.addStaticBox({ x: 0, y: 0.25, z: -3 }, { x: 2, y: 0.25, z: 2 }));
    run(ledge, 2, 0, -2);
    expect(ledge.state.position.y).toBeLessThan(0.1);
    expect(ledge.state.position.z).toBeGreaterThan(-1.1);
  });

  it('walks up a stair, across it and down the far side without sinking into the floor', async () => {
    const ctx = await setup((p) => p.addStaticBox({ x: 0, y: 0.1, z: -3 }, { x: 2, y: 0.1, z: 2 }), { x: 0, y: 1.5, z: 0 });
    let lowest = Infinity, highest = -Infinity;
    for (let i = 0; i < 300; i++) {
      ctx.state.velocity.z = i < 60 ? 0 : -2.4;
      ctx.body.move(ctx.state, DT);
      ctx.physics.step(DT);
      if (i > 60) { lowest = Math.min(lowest, ctx.state.position.y); highest = Math.max(highest, ctx.state.position.y); }
    }
    expect(lowest).toBeGreaterThan(-0.01);
    expect(highest).toBeGreaterThan(0.2);
    expect(ctx.state.position.z).toBeLessThan(-5.5); // past the stair, back on the floor
    expect(ctx.state.position.y).toBeLessThan(0.1);
  });

  it('jumps and lands again', async () => {
    const ctx = await setup(() => {});
    run(ctx, 0.3);
    ctx.state.velocity.y = DEFAULT_CHARACTER.jumpSpeed;
    ctx.state.grounded = false;
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      ctx.body.move(ctx.state, DT);
      ctx.physics.step(DT);
      peak = Math.max(peak, ctx.state.position.y);
    }
    expect(peak).toBeGreaterThan(0.7); // v²/2g ≈ 0.9 m
    expect(ctx.state.grounded).toBe(true);
  });

  it('can always crouch, but only stands up with headroom', async () => {
    // Low ceiling: underside at y = 1.4.
    const ctx = await setup((p) => p.addStaticBox({ x: 0, y: 1.6, z: -3 }, { x: 2, y: 0.2, z: 1 }));
    run(ctx, 0.3);
    expect(ctx.body.setCrouch(ctx.state, true)).toBe(true);
    run(ctx, 1.5, 0, -2); // walk under the low ceiling
    expect(ctx.state.position.z).toBeLessThan(-2.5);
    expect(ctx.body.setCrouch(ctx.state, false)).toBe(true); // blocked: still crouching
    run(ctx, 1.5, 0, 2); // walk back out
    expect(ctx.body.setCrouch(ctx.state, false)).toBe(false);
  });
});
