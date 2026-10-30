// Frame systems that show golden-path state: door swing, the package, the flashlight.

import { Mesh, SpotLight } from 'three/webgpu';
import type { FrameSystem } from '../../engine/core/system';
import { Door, Package, Player } from '../components';
import type { GameContext } from '../context';

const DOOR_SWING = (100 * Math.PI) / 180;

export function doorVisualsSystem(ctx: GameContext): FrameSystem {
  return {
    name: 'doorVisuals',
    frameUpdate(world) {
      for (const [e, rt] of ctx.level.doors) {
        const open = world.require(e, Door).open;
        const eased = open * open * (3 - 2 * open); // smoothstep: creaks open, settles
        rt.pivot.rotation.y = eased * DOOR_SWING;
      }
    },
  };
}

/** On the shelf, held in view at the bottom right, or gone. */
export function packageVisualsSystem(ctx: GameContext): FrameSystem {
  const { camera, scene } = ctx.engine.renderer;
  const mesh = ctx.level.package.mesh;
  const shelf = ctx.level.def.packageShelf;
  let shown: Package['state'] | null = null;
  return {
    name: 'packageVisuals',
    frameUpdate(world) {
      const state = world.require(ctx.level.package.entity, Package).state;
      if (state === shown) return;
      shown = state;
      if (state === 'shelf') {
        ctx.level.root.add(mesh);
        mesh.position.set(shelf.x, shelf.y + 0.12, shelf.z);
        mesh.rotation.set(0, 0.3, 0);
        mesh.scale.setScalar(1);
        mesh.visible = true;
      } else if (state === 'carried') {
        if (!camera.parent) scene.add(camera); // children of the camera only render if it's in the scene
        camera.add(mesh);
        mesh.position.set(0.34, -0.42, -0.72); // low in the corner: present, not in the way
        mesh.scale.setScalar(0.8);
        mesh.rotation.set(0.15, -0.35, 0.05);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    },
  };
}

/** A shadow-casting spotlight on the camera, toggled with F. */
export function flashlightSystem(ctx: GameContext): FrameSystem {
  const { camera, scene, renderer } = ctx.engine.renderer;
  const light = new SpotLight('#fff1d6', 0, 14, 0.42, 0.55, 2);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.0005;
  light.position.set(0.15, -0.1, 0);
  light.target.position.set(0, 0, -1);
  camera.add(light, light.target);
  if (!camera.parent) scene.add(camera);
  renderer.shadowMap.enabled = true;
  ctx.level.root.traverse((o) => {
    if (o instanceof Mesh) {
      o.receiveShadow = true;
      o.castShadow = true;
    }
  });
  let on = false;
  return {
    name: 'flashlight',
    frameUpdate(world) {
      const want = world.require(ctx.player, Player).flashlight;
      if (want !== on) {
        on = want;
        light.intensity = on ? 22 : 0;
      }
    },
    dispose() {
      camera.remove(light, light.target);
      light.dispose();
    },
  };
}
