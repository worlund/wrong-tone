// First-person character: a kinematic capsule moved with Rapier's built-in
// character controller (move-and-slide, slopes, auto-step, snap-to-ground).
// Gravity and jumping are applied here; the controller only resolves collisions.

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics, Vec3 } from './physics';

export interface CharacterSettings {
  /** Capsule radius and total standing height in metres. */
  radius: number;
  height: number;
  crouchHeight: number;
  /** Gap the controller keeps from geometry (Rapier "offset"). */
  skin: number;
  maxSlopeDeg: number;
  stepHeight: number;
  snapToGround: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  /** Seconds to reach full speed / to stop. Short ramps feel responsive but not floaty. */
  accelTime: number;
  decelTime: number;
  /** Air control as a fraction of ground acceleration. */
  airControl: number;
  jumpSpeed: number;
  /** Grace periods that make jumping feel fair: after leaving a ledge / before landing. */
  coyoteTime: number;
  jumpBuffer: number;
  eyeHeight: number;
  crouchEyeHeight: number;
}

export const DEFAULT_CHARACTER: CharacterSettings = {
  radius: 0.35,
  height: 1.75,
  crouchHeight: 1.1,
  // 0.05: with rapier3d-compat 0.21, skins of 0.02 and 0.06 let the capsule dip into the floor
  // after a fall plus snap-to-ground; 0.01/0.03/0.05/0.08 are clean (see character.test.ts).
  skin: 0.05,
  maxSlopeDeg: 45,
  stepHeight: 0.3,
  snapToGround: 0.3,
  walkSpeed: 3.2,
  sprintSpeed: 5.5,
  crouchSpeed: 1.6,
  accelTime: 0.12,
  decelTime: 0.08,
  airControl: 0.3,
  jumpSpeed: 4.2,
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  eyeHeight: 1.6,
  crouchEyeHeight: 0.95,
};

/** Plain-data state of a character, kept in the World so it can be snapshotted. */
export interface CharacterState {
  /** Feet position. */
  position: Vec3;
  /** Previous tick's feet position, for render interpolation. */
  prevPosition: Vec3;
  velocity: Vec3;
  grounded: boolean;
  crouching: boolean;
  /** Seconds since last grounded (for coyote time). */
  airTime: number;
}

const DEG = Math.PI / 180;

export class CharacterBody {
  private body!: RAPIER.RigidBody;
  private colliderRef!: RAPIER.Collider;
  private controller!: RAPIER.KinematicCharacterController;
  private height: number;

  constructor(
    private readonly physics: Physics,
    readonly settings: CharacterSettings = DEFAULT_CHARACTER,
  ) {
    this.height = settings.height;
  }

  /** Creates the kinematic body, capsule collider and controller. */
  spawn(at: Vec3): CharacterState {
    const { rapier: R, world } = this.physics;
    const s = this.settings;
    this.height = s.height;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.y + s.height / 2, at.z),
    );
    this.colliderRef = world.createCollider(R.ColliderDesc.capsule(s.height / 2 - s.radius, s.radius), this.body);
    this.controller = world.createCharacterController(s.skin);
    this.controller.setMaxSlopeClimbAngle(s.maxSlopeDeg * DEG);
    this.controller.setMinSlopeSlideAngle(s.maxSlopeDeg * DEG);
    this.controller.enableAutostep(s.stepHeight, s.radius * 0.5, false);
    this.controller.enableSnapToGround(s.snapToGround);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(true);
    return {
      position: { ...at },
      prevPosition: { ...at },
      velocity: { x: 0, y: 0, z: 0 },
      grounded: false,
      crouching: false,
      airTime: 0,
    };
  }

  /** Moves by state.velocity for one step, applying gravity and resolving collisions. Mutates state. */
  move(state: CharacterState, dt: number): void {
    const v = state.velocity;
    copy(state.prevPosition, state.position);

    // On the ground, ask for no vertical movement: snap-to-ground follows slopes and steps down,
    // and Rapier's auto-step only engages when the request has no downward component
    // (verified against rapier3d-compat 0.21). Gravity applies only in the air.
    if (state.grounded) {
      if (v.y < 0) v.y = 0;
    } else {
      v.y += this.physics.gravity.y * dt;
    }

    const want = { x: v.x * dt, y: v.y * dt, z: v.z * dt };
    this.controller.computeColliderMovement(this.colliderRef, want);
    const moved = this.controller.computedMovement();
    const grounded = this.controller.computedGrounded();

    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + moved.x, y: p.y + moved.y, z: p.z + moved.z });
    state.position.x = p.x + moved.x;
    state.position.y = p.y + moved.y - this.height / 2;
    state.position.z = p.z + moved.z;

    // Lose the velocity that was blocked, so pushing into a wall doesn't store speed.
    if (Math.abs(moved.x) < Math.abs(want.x)) v.x = moved.x / dt;
    if (Math.abs(moved.z) < Math.abs(want.z)) v.z = moved.z / dt;
    if (v.y > 0 && moved.y < want.y * 0.5) v.y = 0; // bumped the ceiling
    if (grounded && v.y < 0) v.y = 0;

    state.grounded = grounded;
    state.airTime = grounded ? 0 : state.airTime + dt;
  }

  /** The capsule collider, e.g. to exclude the player from their own aim casts. */
  get collider(): RAPIER.Collider {
    return this.colliderRef;
  }

  /** Instantly moves the character (ghost wall, respawn). Clears velocity and interpolation. */
  teleport(state: CharacterState, feet: Vec3): void {
    this.body.setTranslation({ x: feet.x, y: feet.y + this.height / 2, z: feet.z }, true);
    copy(state.position, feet);
    copy(state.prevPosition, feet);
    state.velocity.x = state.velocity.y = state.velocity.z = 0;
    state.grounded = false;
    state.airTime = 0;
  }

  /** Crouching always succeeds; standing up only when there is headroom. Returns the new state. */
  setCrouch(state: CharacterState, crouch: boolean): boolean {
    if (crouch === state.crouching) return crouch;
    const s = this.settings;
    const target = crouch ? s.crouchHeight : s.height;
    const feet = this.body.translation().y - this.height / 2;
    const center = { x: state.position.x, y: feet + target / 2 + 0.01, z: state.position.z };
    if (!crouch) {
      const R = this.physics.rapier;
      const probe = new R.Capsule(target / 2 - s.radius, s.radius - 0.01);
      const hit = this.physics.world.intersectionWithShape(
        center, { x: 0, y: 0, z: 0, w: 1 }, probe, undefined, undefined, this.colliderRef,
      );
      if (hit) return true; // something above: stay crouched
    }
    this.colliderRef.setHalfHeight(target / 2 - s.radius);
    this.body.setTranslation(center, true);
    this.height = target;
    state.crouching = crouch;
    return crouch;
  }

  dispose(): void {
    const { world } = this.physics;
    if (this.controller) world.removeCharacterController(this.controller);
    if (this.body) world.removeRigidBody(this.body);
  }
}

function copy(to: Vec3, from: Vec3): void {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
}
