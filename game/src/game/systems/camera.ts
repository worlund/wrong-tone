// First-person camera, every rendered frame. Look comes straight from input (no tick delay);
// position is interpolated between the last two simulation states.

import type { FrameSystem } from '../../engine/core/system';
import { Player } from '../components';
import type { GameContext } from '../context';

const BOB_FREQ = 1.9; // bob cycles per metre... scaled by stride below
const BOB_Y = 0.028;
const BOB_X = 0.014;

export function cameraSystem(ctx: GameContext): FrameSystem {
  const s = ctx.character.settings;
  const { camera } = ctx.engine.renderer;
  const baseFov = camera.fov;
  let eye = s.eyeHeight;
  let bobPhase = 0;
  let bobAmount = 0;
  let fov = baseFov;
  const fwd = { x: 0, y: 0, z: -1 };
  const up = { x: 0, y: 1, z: 0 };
  const pos = { x: 0, y: 0, z: 0 };

  return {
    name: 'cameraLook',
    frameUpdate(world, alpha, dt) {
      const p = world.require(ctx.player, Player);
      const ch = p.character;
      const look = ctx.engine.input.state.look;

      // Smooth crouch transition (~80 ms) instead of snapping the eye.
      const targetEye = ch.crouching ? s.crouchEyeHeight : s.eyeHeight;
      eye += (targetEye - eye) * (1 - Math.exp(-dt / 0.08));

      // Head bob follows ground speed; fades in and out rather than switching.
      const speed = Math.hypot(ch.velocity.x, ch.velocity.z);
      const bobTarget = ctx.settings.headBob && ch.grounded ? Math.min(1, speed / s.walkSpeed) : 0;
      bobAmount += (bobTarget - bobAmount) * (1 - Math.exp(-dt / 0.15));
      bobPhase += speed * dt * BOB_FREQ * Math.PI;
      const bobY = Math.abs(Math.sin(bobPhase)) * BOB_Y * bobAmount;
      const bobX = Math.cos(bobPhase) * BOB_X * bobAmount;

      const a = ch.prevPosition, b = ch.position;
      pos.x = a.x + (b.x - a.x) * alpha;
      pos.y = a.y + (b.y - a.y) * alpha + eye + bobY;
      pos.z = a.z + (b.z - a.z) * alpha;
      const sin = Math.sin(look.yaw), cos = Math.cos(look.yaw);
      camera.position.set(pos.x + cos * bobX, pos.y, pos.z - sin * bobX);
      camera.rotation.set(look.pitch, look.yaw, 0);

      // Sprint FOV kick, eased.
      const targetFov = baseFov + (p.sprinting && speed > s.walkSpeed ? ctx.settings.sprintFovKick : 0);
      fov += (targetFov - fov) * (1 - Math.exp(-dt / 0.2));
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      // The audio listener rides on the camera.
      const cp = Math.cos(look.pitch);
      fwd.x = -sin * cp;
      fwd.y = Math.sin(look.pitch);
      fwd.z = -cos * cp;
      ctx.engine.audio.setListener(camera.position, fwd, up);
    },
  };
}
