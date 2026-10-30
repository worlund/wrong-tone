// Player movement on the fixed step: input command → desired velocity → character controller.

import type { SimSystem } from '../../engine/core/system';
import { Player } from '../components';
import type { GameContext } from '../context';

const STRIDE_WALK = 0.75; // metres between footsteps
const STRIDE_SPRINT = 1.0;
const STAMINA_DRAIN = 0.22; // per second while sprinting (~4.5 s of sprint)
const STAMINA_REGEN = 0.18;

export function movementSystem(ctx: GameContext): SimSystem {
  const s = ctx.character.settings;
  return {
    name: 'playerMovement',
    fixedUpdate(world, dt) {
      const p = world.require(ctx.player, Player);
      const c = ctx.engine.command;
      const ch = p.character;
      const wasGrounded = ch.grounded;
      const fallSpeed = -ch.velocity.y;
      p.yaw = c.yaw;
      p.pitch = c.pitch;

      ctx.character.setCrouch(ch, c.held.has('crouch'));

      // Sprint: forward only, not crouched, with a stamina lockout so it can't be feathered.
      if (p.stamina <= 0) p.sprintLocked = true;
      if (p.sprintLocked && p.stamina > 0.3) p.sprintLocked = false;
      p.sprinting = c.held.has('sprint') && c.moveZ > 0 && !ch.crouching && !p.sprintLocked;
      p.stamina = Math.min(1, Math.max(0, p.stamina + (p.sprinting ? -STAMINA_DRAIN : STAMINA_REGEN) * dt));
      const speed = ch.crouching ? s.crouchSpeed : p.sprinting ? s.sprintSpeed : s.walkSpeed;

      // Wish direction in world space. Yaw 0 looks down -Z.
      const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
      const wx = cos * c.moveX - sin * c.moveZ;
      const wz = -sin * c.moveX - cos * c.moveZ;
      const tx = wx * speed, tz = wz * speed;

      // Accelerate towards the target; stop faster than you start. Less control in the air.
      const v = ch.velocity;
      const accelerating = tx !== 0 || tz !== 0;
      let rate = accelerating ? speed / s.accelTime : s.walkSpeed / s.decelTime;
      if (!ch.grounded) rate *= s.airControl;
      const dx = tx - v.x, dz = tz - v.z;
      const dist = Math.hypot(dx, dz);
      const stepLen = rate * dt;
      if (dist <= stepLen) {
        v.x = tx;
        v.z = tz;
      } else {
        v.x += (dx / dist) * stepLen;
        v.z += (dz / dist) * stepLen;
      }

      // Jump with buffering (press slightly before landing) and coyote time (just after leaving a ledge).
      p.jumpBuffer = c.pressed.has('jump') ? s.jumpBuffer : Math.max(0, p.jumpBuffer - dt);
      if (p.jumpBuffer > 0 && ch.airTime <= s.coyoteTime && !ch.crouching && v.y <= 0.01) {
        v.y = s.jumpSpeed;
        ch.grounded = false;
        ch.airTime = s.coyoteTime + 1; // no second jump from coyote time
        p.jumpBuffer = 0;
      }

      ctx.character.move(ch, dt);

      // Footsteps and landings as events; audio decides how they sound.
      if (ch.grounded) {
        p.stride += Math.hypot(v.x, v.z) * dt;
        const strideLen = p.sprinting ? STRIDE_SPRINT : STRIDE_WALK;
        if (p.stride >= strideLen) {
          p.stride = 0;
          ctx.engine.events.emit('sound', { cue: p.sprinting ? 'footstepRun' : ch.crouching ? 'footstepSoft' : 'footstep', position: { ...ch.position } });
        }
        if (!wasGrounded && fallSpeed > 2.5) {
          ctx.engine.events.emit('sound', { cue: 'land', position: { ...ch.position } });
        }
      } else {
        p.stride = STRIDE_WALK * 0.6; // first step comes quickly after landing
      }
    },
  };
}
