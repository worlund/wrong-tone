import { describe, expect, it } from 'vitest';
import { InputState, wrapAngle } from '../../src/engine/input/input';

describe('InputState', () => {
  it('maps key codes to actions through bindings', () => {
    const s = new InputState();
    expect(s.keyDown('KeyW')).toBe(true);
    expect(s.keyDown('KeyQ')).toBe(false);
    expect(s.sampleCommand().held.has('moveForward')).toBe(true);
    expect(s.sampleCommand().moveZ).toBe(1);
  });

  it('reports an action in pressed for exactly one tick', () => {
    const s = new InputState();
    s.keyDown('KeyE');
    expect(s.sampleCommand().pressed.has('interact')).toBe(true);
    expect(s.sampleCommand().pressed.has('interact')).toBe(false);
  });

  it('still reports a tap that went down and up between two ticks', () => {
    const s = new InputState();
    s.keyDown('Space');
    s.keyUp('Space');
    const c = s.sampleCommand();
    expect(c.pressed.has('jump')).toBe(true);
    expect(c.held.has('jump')).toBe(false);
  });

  it('ignores key auto-repeat for presses', () => {
    const s = new InputState();
    s.keyDown('KeyE');
    s.sampleCommand();
    s.keyDown('KeyE', true);
    expect(s.sampleCommand().pressed.has('interact')).toBe(false);
  });

  it('normalises diagonal movement to length 1', () => {
    const s = new InputState();
    s.keyDown('KeyW');
    s.keyDown('KeyD');
    const c = s.sampleCommand();
    expect(Math.hypot(c.moveX, c.moveZ)).toBeCloseTo(1);
    expect(c.moveX).toBeGreaterThan(0);
  });

  it('keeps an action held while either bound key is down', () => {
    const s = new InputState();
    s.keyDown('KeyW');
    s.keyDown('ArrowUp');
    s.keyUp('KeyW');
    expect(s.sampleCommand().moveZ).toBe(1);
  });

  it('releases all keys when the window loses focus', () => {
    const s = new InputState();
    s.keyDown('KeyW');
    s.releaseAll();
    expect(s.sampleCommand().moveZ).toBe(0);
  });

  it('turns mouse movement into yaw/pitch with clamped pitch', () => {
    const s = new InputState();
    s.sensitivity = 0.01;
    s.mouseMove(100, 0);
    expect(s.applyLook().yaw).toBeCloseTo(-1);
    s.mouseMove(0, -100000);
    expect(s.applyLook().pitch).toBeCloseTo((89 * Math.PI) / 180);
  });
});

describe('wrapAngle', () => {
  it('keeps angles in [-π, π)', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-0.5)).toBeCloseTo(-0.5);
  });
});
