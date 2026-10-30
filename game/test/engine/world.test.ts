import { describe, expect, it } from 'vitest';
import { defineComponent, World } from '../../src/engine/world/world';
import { EventBus } from '../../src/engine/core/events';

const Pos = defineComponent<{ x: number }>('Pos');
const Tag = defineComponent<{ name: string }>('Tag');

describe('World', () => {
  it('creates entities with unique, never-reused ids', () => {
    const w = new World();
    const a = w.createEntity();
    w.destroyEntity(a);
    const b = w.createEntity();
    expect(b).not.toBe(a);
    expect(w.isAlive(a)).toBe(false);
  });

  it('adds, gets and removes components by type', () => {
    const w = new World();
    const e = w.createEntity();
    w.add(e, Pos, { x: 3 });
    expect(w.get(e, Pos)?.x).toBe(3);
    expect(w.get(e, Tag)).toBeUndefined();
    w.remove(e, Pos);
    expect(w.get(e, Pos)).toBeUndefined();
    expect(() => w.require(e, Pos)).toThrow(/no Pos/);
  });

  it('queries entities that have all given components, in creation order', () => {
    const w = new World();
    const a = w.createEntity(), b = w.createEntity(), c = w.createEntity();
    w.add(c, Pos, { x: 0 }); w.add(c, Tag, { name: 'c' });
    w.add(a, Tag, { name: 'a' }); w.add(a, Pos, { x: 0 });
    w.add(b, Pos, { x: 0 });
    expect(w.query(Pos, Tag)).toEqual([a, c]);
    expect(w.query(Pos)).toEqual([a, b, c]);
  });

  it('returns the same cached array until the world changes', () => {
    const w = new World();
    w.add(w.createEntity(), Pos, { x: 0 });
    const first = w.query(Pos);
    expect(w.query(Pos)).toBe(first);
    w.add(w.createEntity(), Pos, { x: 1 });
    expect(w.query(Pos)).not.toBe(first);
    expect(w.query(Pos)).toHaveLength(2);
  });

  it('drops all components of a destroyed entity', () => {
    const w = new World();
    const e = w.createEntity();
    w.add(e, Pos, { x: 1 });
    w.destroyEntity(e);
    expect(w.query(Pos)).toEqual([]);
    expect(() => w.add(e, Pos, { x: 2 })).toThrow(/not alive/);
  });
});

describe('EventBus', () => {
  type Ev = { hit: number; miss: string };

  it('delivers events to handlers of that type in subscription order', () => {
    const bus = new EventBus<Ev>();
    const got: string[] = [];
    bus.on('hit', (n) => got.push(`a${n}`));
    bus.on('hit', (n) => got.push(`b${n}`));
    bus.on('miss', (s) => got.push(s));
    bus.emit('hit', 1);
    expect(got).toEqual(['a1', 'b1']);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus<Ev>();
    let n = 0;
    const off = bus.on('hit', () => n++);
    bus.emit('hit', 1);
    off();
    bus.emit('hit', 1);
    expect(n).toBe(1);
  });

  it('allows unsubscribing from inside a handler', () => {
    const bus = new EventBus<Ev>();
    const got: string[] = [];
    const off = bus.on('hit', () => { got.push('once'); off(); });
    bus.on('hit', () => got.push('always'));
    bus.emit('hit', 1);
    bus.emit('hit', 2);
    expect(got).toEqual(['once', 'always', 'always']);
  });
});
