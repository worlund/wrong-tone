// Turns a LevelDef into physics colliders, meshes and entities.
// Visible surfaces are planes (clean texture tiling); collision uses separate boxes.

import type RAPIER from '@dimforge/rapier3d-compat';
import {
  BoxGeometry, CanvasTexture, Color, FogExp2, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PlaneGeometry, PointLight, SRGBColorSpace, type Texture,
} from 'three/webgpu';
import type { Engine } from '../../engine/engine';
import type { Entity } from '../../engine/world/world';
import { markAsSign } from '../../engine/render/post';
import { Door, FluorescentLight, Interactable, Package, type SignText } from '../components';
import type { GameEvents } from '../events';
import type { LevelDef } from './room01';
import { AMBIENT } from './constants';
import { carpet, ceilingTiles, wallpaper } from './textures';

export interface LightVisual {
  light: PointLight;
  panel: MeshBasicMaterial;
  baseColor: Color;
}

export interface DoorRuntime {
  slot: number;
  collider: RAPIER.Collider;
  /** Rotates around the hinge; the door swings into the corridor behind it. */
  pivot: Group;
  /** World position of the doorway centre at floor level. */
  doorway: { x: number; y: number; z: number };
  sign: { canvas: HTMLCanvasElement; texture: CanvasTexture };
}

export interface Level {
  def: LevelDef;
  root: Group;
  lights: Map<Entity, LightVisual>;
  /** Ambient fill; dimmed with the lights during the blackout. */
  ambient: HemisphereLight;
  doors: Map<Entity, DoorRuntime>;
  package: { entity: Entity; mesh: Group; collider: RAPIER.Collider };
  /** Collider handle → interactable entity, for aim casts. */
  targets: Map<number, Entity>;
  /** Gives the exit role to one door slot and the decoy to the others; redraws the signs. */
  assignDoors(exitSlot: number): void;
  dispose(): void;
}

const WALL_T = 0.2; // collider thickness, outside the room
const DOOR_H = 2.1;
const CORRIDOR_DEPTH = 6;
const LIGHT_INTENSITY = 28; // candela-ish (physically based units since three r155)

export function buildLevel(def: LevelDef, engine: Engine<GameEvents>): Level {
  const { physics, renderer, world } = engine;
  const { width: W, depth: D, height: H } = def.size;
  const root = new Group();
  root.name = def.name;
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const targets = new Map<number, Entity>();

  const wallTex = track(wallpaper());
  const floorTex = track(carpet());
  const ceilTex = track(ceilingTiles());

  // A textured plane facing +Z before rotation; repeat in metres per tile.
  const plane = (tex: Texture, w: number, h: number, tile: number) => {
    const t = track(tex.clone());
    t.repeat.set(w / tile, h / tile);
    const mat = track(new MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0 }));
    const mesh = new Mesh(track(new PlaneGeometry(w, h)), mat);
    root.add(mesh);
    return mesh;
  };
  const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) =>
    physics.addStaticBox({ x: cx, y: cy, z: cz }, { x: hx, y: hy, z: hz });

  // Floor and ceiling.
  const floor = plane(floorTex, W, D, 1);
  floor.rotation.x = -Math.PI / 2;
  box(0, -WALL_T / 2, 0, W / 2 + WALL_T, WALL_T / 2, D / 2 + WALL_T);
  const ceiling = plane(ceilTex, W, D, 1.2);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  box(0, H + WALL_T / 2, 0, W / 2 + WALL_T, WALL_T / 2, D / 2 + WALL_T);

  // Side and back walls.
  const wall = (w: number, h: number, x: number, y: number, z: number, rotY: number) => {
    const m = plane(wallTex, w, h, 1);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
  };
  wall(D, H, -W / 2, H / 2, 0, Math.PI / 2);
  box(-W / 2 - WALL_T / 2, H / 2, 0, WALL_T / 2, H / 2, D / 2);
  wall(D, H, W / 2, H / 2, 0, -Math.PI / 2);
  box(W / 2 + WALL_T / 2, H / 2, 0, WALL_T / 2, H / 2, D / 2);
  wall(W, H, 0, H / 2, D / 2, Math.PI);
  box(0, H / 2, D / 2 + WALL_T / 2, W / 2, H / 2, WALL_T / 2);

  // Far wall in segments around the door openings, plus a lintel over each door.
  const zFar = -D / 2;
  const slots = [...def.signDoors].sort((a, b) => a.x - b.x);
  let cursor = -W / 2;
  for (const [a, b] of [...slots.map((d) => [d.x - d.width / 2, d.x + d.width / 2] as const), [W / 2, W / 2] as const]) {
    if (a - cursor > 0.001) {
      wall(a - cursor, H, (cursor + a) / 2, H / 2, zFar, 0);
      box((cursor + a) / 2, H / 2, zFar - WALL_T / 2, (a - cursor) / 2, H / 2, WALL_T / 2);
    }
    if (b > a) {
      wall(b - a, H - DOOR_H, (a + b) / 2, (H + DOOR_H) / 2, zFar, 0);
      box((a + b) / 2, (H + DOOR_H) / 2, zFar - WALL_T / 2, (b - a) / 2, (H - DOOR_H) / 2, WALL_T / 2);
    }
    cursor = b;
  }

  // Doors: a hinged pivot, a collider, a sign above, and a dark corridor behind.
  const doorMat = track(new MeshStandardMaterial({ color: '#4a3622', roughness: 0.7 }));
  const handleMat = track(new MeshStandardMaterial({ color: '#b9ab84', roughness: 0.35, metalness: 0.8 }));
  const darkMat = track(new MeshStandardMaterial({ color: '#16130b', roughness: 1 }));
  const doors = new Map<Entity, DoorRuntime>();
  slots.forEach((d, slot) => {
    const z = zFar - 0.06;
    const pivot = new Group();
    pivot.position.set(d.x - d.width / 2 + 0.02, 0, z);
    const slab = new Mesh(track(new BoxGeometry(d.width - 0.04, DOOR_H - 0.02, 0.05)), doorMat);
    slab.position.set((d.width - 0.04) / 2, DOOR_H / 2, 0);
    const handle = new Mesh(track(new BoxGeometry(0.12, 0.03, 0.06)), handleMat);
    handle.position.set(d.width - 0.16, 1.0, 0.04);
    pivot.add(slab, handle);
    root.add(pivot);
    const collider = box(d.x, DOOR_H / 2, z, d.width / 2, DOOR_H / 2, 0.05);

    // Sign on the lintel: same style for every door, so only the characters tell them apart.
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 112;
    const texture = track(new CanvasTexture(canvas));
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const signMat = track(new MeshBasicMaterial({ map: texture }));
    markAsSign(signMat);
    // Big enough to read from mid-room at the 520-pixel internal resolution; fits the 0.5 m lintel.
    const sign = new Mesh(track(new PlaneGeometry(0.9, 0.39)), signMat);
    sign.position.set(d.x, DOOR_H + 0.23, zFar + 0.012);
    root.add(sign);

    // Corridor of darkness behind the door.
    const cz = zFar - CORRIDOR_DEPTH / 2;
    const cw = d.width + 0.3;
    const dark = (w: number, h: number, x: number, y: number, zz: number, rx: number, ry: number) => {
      const m = new Mesh(track(new PlaneGeometry(w, h)), darkMat);
      m.position.set(x, y, zz);
      m.rotation.set(rx, ry, 0);
      root.add(m);
    };
    dark(cw, CORRIDOR_DEPTH, d.x, 0.001, cz, -Math.PI / 2, 0);
    dark(cw, CORRIDOR_DEPTH, d.x, DOOR_H + 0.1, cz, Math.PI / 2, 0);
    dark(CORRIDOR_DEPTH, DOOR_H + 0.1, d.x - cw / 2, (DOOR_H + 0.1) / 2, cz, 0, Math.PI / 2);
    dark(CORRIDOR_DEPTH, DOOR_H + 0.1, d.x + cw / 2, (DOOR_H + 0.1) / 2, cz, 0, -Math.PI / 2);
    dark(cw, DOOR_H + 0.1, d.x, (DOOR_H + 0.1) / 2, zFar - CORRIDOR_DEPTH, 0, 0);
    box(d.x - cw / 2 - WALL_T / 2, H / 2, cz, WALL_T / 2, H / 2, CORRIDOR_DEPTH / 2);
    box(d.x + cw / 2 + WALL_T / 2, H / 2, cz, WALL_T / 2, H / 2, CORRIDOR_DEPTH / 2);
    box(d.x, H / 2, zFar - CORRIDOR_DEPTH - WALL_T / 2, cw / 2, H / 2, WALL_T / 2);
    box(d.x, -WALL_T / 2, cz, cw / 2, WALL_T / 2, CORRIDOR_DEPTH / 2);

    const e = world.createEntity();
    world.add(e, Door, { role: 'decoy', sign: { hanzi: '', pinyin: '', meaning: '' }, open: 0, opening: false });
    world.add(e, Interactable, { prompt: '', range: 2.2 });
    targets.set(collider.handle, e);
    doors.set(e, { slot, collider, pivot, doorway: { x: d.x, y: 0, z: zFar }, sign: { canvas, texture } });
  });

  const drawSign = (rt: DoorRuntime, text: SignText) => {
    const g = rt.sign.canvas.getContext('2d')!;
    g.fillStyle = '#1f6b3a';
    g.fillRect(0, 0, 256, 112);
    g.strokeStyle = '#e8f0e0';
    g.lineWidth = 4;
    g.strokeRect(6, 6, 244, 100);
    g.fillStyle = '#f4f7ee';
    g.font = 'bold 64px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", "Source Han Sans SC", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.hanzi, 128, 58);
    rt.sign.texture.needsUpdate = true;
  };

  // Baseboards: a dark strip that grounds the walls visually.
  const baseMat = track(new MeshStandardMaterial({ color: '#5e5130', roughness: 0.8 }));
  const baseGeo = track(new BoxGeometry(1, 0.1, 0.02));
  const baseboard = (len: number, x: number, z: number, rotY: number) => {
    const m = new Mesh(baseGeo, baseMat);
    m.scale.x = len;
    m.position.set(x, 0.05, z);
    m.rotation.y = rotY;
    root.add(m);
  };
  baseboard(D, -W / 2 + 0.01, 0, Math.PI / 2);
  baseboard(D, W / 2 - 0.01, 0, Math.PI / 2);
  baseboard(W, 0, D / 2 - 0.01, 0);

  // The package shelf and the package on it.
  const s = def.packageShelf;
  const shelf = new Mesh(track(new BoxGeometry(0.45, s.y, 1.0)), track(new MeshStandardMaterial({ color: '#6b6656', roughness: 0.6, metalness: 0.3 })));
  shelf.position.set(s.x, s.y / 2, s.z);
  root.add(shelf);
  box(s.x, s.y / 2, s.z, 0.225, s.y / 2, 0.5);

  const pkgMesh = new Group();
  const cardboard = new Mesh(track(new BoxGeometry(0.34, 0.24, 0.3)), track(new MeshStandardMaterial({ color: '#a77d48', roughness: 0.85 })));
  const tape = new Mesh(track(new BoxGeometry(0.345, 0.006, 0.07)), track(new MeshStandardMaterial({ color: '#c9b27a', roughness: 0.4 })));
  tape.position.y = 0.121;
  pkgMesh.add(cardboard, tape);
  root.add(pkgMesh);
  const pkgCollider = box(s.x, s.y + 0.12, s.z, 0.17, 0.12, 0.15);
  const pkg = world.createEntity();
  world.add(pkg, Package, { state: 'shelf' });
  world.add(pkg, Interactable, { prompt: '', range: 2.2 });
  targets.set(pkgCollider.handle, pkg);

  // Fluorescent panels: an unlit quad plus a point light, driven by the lights system.
  const lights = new Map<Entity, LightVisual>();
  const panelGeo = track(new PlaneGeometry(1.2, 0.6));
  const frameGeo = track(new PlaneGeometry(1.32, 0.72));
  const frameMat = track(new MeshStandardMaterial({ color: '#77715f', roughness: 0.5, metalness: 0.4 }));
  def.lights.forEach((l, i) => {
    const panelMat = track(new MeshBasicMaterial({ color: '#fff4d6' }));
    const panel = new Mesh(panelGeo, panelMat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(l.x, H - 0.02, l.z);
    root.add(panel);
    const frame = new Mesh(frameGeo, frameMat); // troffer housing around the tube
    frame.rotation.x = Math.PI / 2;
    frame.position.set(l.x, H - 0.01, l.z);
    root.add(frame);
    const light = new PointLight('#ffefc4', LIGHT_INTENSITY, 10, 2);
    light.position.set(l.x, H - 0.6, l.z); // low enough not to blow out the ceiling around the tube
    root.add(light);
    const e = world.createEntity();
    world.add(e, FluorescentLight, { baseIntensity: LIGHT_INTENSITY, flicker: l.flicker, level: 1, burst: 0, seed: i * 7919 + 13 });
    // Over-bright (HDR) so tone mapping renders the tube white, brighter than the ceiling it lights.
    lights.set(e, { light, panel: panelMat, baseColor: panelMat.color.clone().multiplyScalar(6) });
  });
  const ambient = new HemisphereLight('#fff2cc', '#4a3c18', AMBIENT);
  root.add(ambient);

  const scene = renderer.scene;
  scene.background = new Color('#0b0904');
  scene.fog = new FogExp2('#2b2410', 0.035);
  scene.add(root);

  const pair = def.signPairs[0]!;
  return {
    def,
    root,
    lights,
    ambient,
    doors,
    package: { entity: pkg, mesh: pkgMesh, collider: pkgCollider },
    targets,
    assignDoors(exitSlot) {
      for (const [e, rt] of doors) {
        const door = world.require(e, Door);
        door.role = rt.slot === exitSlot ? 'exit' : 'decoy';
        door.sign = door.role === 'exit' ? pair.correct : pair.distractor;
        drawSign(rt, door.sign);
      }
    },
    dispose() {
      scene.remove(root);
      for (const d of disposables) d.dispose();
    },
  };
}
