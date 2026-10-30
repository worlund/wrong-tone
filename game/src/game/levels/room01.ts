// Room 01: a 6 × 8 m Backrooms room. Plain data; the level builder (M1) turns it
// into physics colliders, meshes and entities. Units: metres, +Y up, -Z forward.

import type { Vec3 } from '../../engine/physics/physics';

export interface LevelDef {
  name: string;
  size: { width: number; depth: number; height: number };
  spawn: Vec3;
  spawnYaw: number;
  /** Ceiling light panels (x, z); y is the ceiling. */
  lights: { x: number; z: number; flicker: number }[];
  /** Two sign doors on the far wall; which side is correct is randomised per run. */
  signDoors: { x: number; z: number; width: number }[];
  /** Pairs used for the sign doors: [correct, distractor]. */
  signPairs: { correct: { hanzi: string; pinyin: string; meaning: string }; distractor: { hanzi: string; pinyin: string; meaning: string } }[];
  packageShelf: Vec3;
}

export const ROOM_01: LevelDef = {
  name: 'room01',
  size: { width: 6, depth: 8, height: 2.6 },
  spawn: { x: 0, y: 0, z: 3 },
  spawnYaw: 0,
  lights: [
    { x: -1.5, z: 2, flicker: 0 },
    { x: 1.5, z: 2, flicker: 0 },
    { x: -1.5, z: -2, flicker: 0.6 },
    { x: 1.5, z: -2, flicker: 0 },
  ],
  signDoors: [
    { x: -1.4, z: -4, width: 1.0 },
    { x: 1.4, z: -4, width: 1.0 },
  ],
  signPairs: [
    {
      correct: { hanzi: '出口', pinyin: 'chūkǒu', meaning: 'exit' },
      distractor: { hanzi: '入口', pinyin: 'rùkǒu', meaning: 'entrance' },
    },
  ],
  packageShelf: { x: 2.6, y: 0.9, z: 1.5 },
};
