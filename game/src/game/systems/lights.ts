// Fluorescent flicker. The simulation decides each light's level deterministically from
// (seed, tick), so every co-op client would see the same flicker; the frame system shows it.

import type { FrameSystem, SimSystem } from '../../engine/core/system';
import { FluorescentLight } from '../components';
import type { GameContext } from '../context';
import { AMBIENT } from '../levels/constants';

/** Deterministic hash → [0, 1). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** isBlackout: when true (the encounter), every light is off. */
export function lightsSimSystem(isBlackout: () => boolean = () => false): SimSystem {
  return {
    name: 'lights',
    fixedUpdate(world, _dt, tick) {
      const blackout = isBlackout();
      for (const e of world.query(FluorescentLight)) {
        const l = world.require(e, FluorescentLight);
        if (blackout) {
          l.level = 0;
          continue;
        }
        if (l.flicker <= 0 && l.burst === 0) {
          l.level = 1;
          continue;
        }
        if (l.burst > 0) {
          // Inside a burst: stutter between dark and bright.
          l.burst--;
          l.level = hash01(l.seed, tick) < 0.45 ? 0.08 : 0.9 + 0.1 * hash01(l.seed + 1, tick);
        } else {
          l.level = 0.97 + 0.03 * hash01(l.seed + 2, tick >> 2); // faint hum-rate wobble
          if (hash01(l.seed + 3, tick) < l.flicker * 0.006) l.burst = 6 + Math.floor(hash01(l.seed + 4, tick) * 30);
        }
      }
    },
  };
}

export function lightsFrameSystem(ctx: GameContext): FrameSystem {
  return {
    name: 'lightVisuals',
    frameUpdate(world) {
      let total = 0;
      for (const [e, v] of ctx.level.lights) {
        const l = world.require(e, FluorescentLight);
        v.light.intensity = l.baseIntensity * l.level;
        v.panel.color.copy(v.baseColor).multiplyScalar(0.02 + 0.98 * l.level);
        total += l.level;
      }
      // Ambient fill follows the lights, so a blackout is properly dark.
      ctx.level.ambient.intensity = AMBIENT * (0.03 + 0.97 * (total / Math.max(1, ctx.level.lights.size)));
    },
  };
}
