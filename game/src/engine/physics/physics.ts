// Owns the Rapier world. Stepped once per fixed tick with the same step as the loop.
// Rapier is Rust compiled to WASM; the -compat build embeds the binary, so no bundler plugin.

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Service } from '../core/system';

export type Rapier = typeof RAPIER;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AimHit {
  handle: number;
  distance: number;
}

export class Physics implements Service {
  readonly name = 'physics';
  /** Available after init(). */
  rapier!: Rapier;
  world!: RAPIER.World;

  constructor(readonly gravity: Vec3 = { x: 0, y: -9.81, z: 0 }) {}

  async init(): Promise<void> {
    // Dynamic import keeps the ~1.5 MB WASM out of the first chunk.
    this.rapier = (await import('@dimforge/rapier3d-compat')).default;
    await this.rapier.init();
    this.world = new this.rapier.World(this.gravity);
  }

  /** Static axis-aligned box for level geometry (walls, floor, ceiling, props). */
  addStaticBox(center: Vec3, halfExtents: Vec3): RAPIER.Collider {
    const desc = this.rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setTranslation(center.x, center.y, center.z);
    return this.world.createCollider(desc);
  }

  /**
   * What the player is aiming at. A precise ray first; if it doesn't land on a target, a thin
   * sphere sweep that only considers targets (aim assist) and never reaches past the first
   * thing the ray hit, so nothing is usable through a wall.
   */
  aimCast(
    origin: Vec3, dir: Vec3, maxDist: number, isTarget: (handle: number) => boolean,
    exclude?: RAPIER.Collider, assistRadius = 0.08,
  ): AimHit | null {
    const R = this.rapier;
    const ray = this.world.castRay(new R.Ray(origin, dir), maxDist, true, undefined, undefined, exclude);
    if (ray && isTarget(ray.collider.handle)) return { handle: ray.collider.handle, distance: ray.timeOfImpact };
    const reach = ray ? Math.min(maxDist, ray.timeOfImpact + 0.05) : maxDist;
    const sweep = this.world.castShape(
      origin, { x: 0, y: 0, z: 0, w: 1 }, dir, new R.Ball(assistRadius), 0, reach, false,
      undefined, undefined, exclude, undefined, (c) => isTarget(c.handle),
    );
    return sweep ? { handle: sweep.collider.handle, distance: sweep.time_of_impact } : null;
  }

  removeCollider(collider: RAPIER.Collider): void {
    this.world.removeCollider(collider, false);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  dispose(): void {
    this.world?.free();
  }
}
