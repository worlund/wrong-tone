import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../../src/engine/core/loop';

function makeLoop(step = 0.1, maxFrameTime = 0.25) {
  const calls: string[] = [];
  const alphas: number[] = [];
  const loop = new FixedStepLoop(
    {
      fixedUpdate: (_s, tick) => calls.push(`fixed${tick}`),
      frameUpdate: (alpha) => {
        calls.push('frame');
        alphas.push(alpha);
      },
    },
    { step, maxFrameTime },
  );
  return { loop, calls, alphas };
}

describe('FixedStepLoop', () => {
  it('runs one fixedUpdate per whole step of accumulated time', () => {
    const { loop, calls } = makeLoop();
    loop.advance(0.25);
    expect(calls.filter((c) => c.startsWith('fixed'))).toHaveLength(2);
  });

  it('carries the remainder to the next frame and reports it as alpha in [0, 1)', () => {
    const { loop, alphas } = makeLoop();
    loop.advance(0.25); // 2 steps, 0.05 left
    expect(alphas[0]).toBeCloseTo(0.5);
    loop.advance(0.06); // 0.11 → 1 step, 0.01 left
    expect(loop.ticksLastFrame).toBe(1);
    expect(alphas[1]).toBeCloseTo(0.1);
  });

  it('clamps a long frame to maxFrameTime (no catch-up spiral)', () => {
    const { loop } = makeLoop(0.1, 0.25);
    loop.advance(10);
    expect(loop.ticksLastFrame).toBe(2);
  });

  it('calls frameUpdate exactly once per frame, after the fixed updates', () => {
    const { loop, calls } = makeLoop();
    loop.advance(0.2);
    expect(calls).toEqual(['fixed0', 'fixed1', 'frame']);
  });

  it('increments tick once per fixedUpdate', () => {
    const { loop } = makeLoop();
    for (let i = 0; i < 10; i++) loop.advance(0.1);
    expect(loop.tick).toBe(10);
  });

  it('does not advance the simulation while paused, but still renders', () => {
    const { loop, calls } = makeLoop();
    loop.paused = true;
    loop.advance(0.2);
    expect(calls).toEqual(['frame']);
    expect(loop.tick).toBe(0);
  });
});
