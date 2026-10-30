# Wrong Tone — game

Browser co-op horror where Mandarin is the mechanic. Design doc: https://claude.ai/artifact/8HaN7NKRXGBE1faapWq4pf

```sh
npm install
npm run dev        # http://localhost:5173  (?webgl forces the WebGL 2 backend)
npm test           # unit tests
npm run build      # type check + production build
```

Stack (exact versions pinned in package.json): Vite 8, TypeScript 7 strict, three r186 `WebGPURenderer` with automatic WebGL 2 fallback, Rapier 0.21 (WASM), Vitest.

## Layout

```
src/
  main.ts                 boot
  engine/                 game-agnostic; never imports from game/
    engine.ts             composition root: services, world, loop, system order
    core/loop.ts          fixed 60 Hz step + interpolated rendering
    core/events.ts        typed event bus
    core/system.ts        Service / SimSystem / FrameSystem contracts
    world/world.ts        typed entity store, plain-data components
    input/                actions + bindings, pointer lock, per-tick commands
    physics/              Rapier world, kinematic character controller
    render/               renderer (WebGPU/WebGL 2, low internal res), post pipeline
    audio/                AudioContext, buses, HRTF positional sound
    debug/                F3 overlay
  game/                   Wrong Tone itself
    components.ts         gameplay data
    events.ts             typed game events (word events → language log)
    flow.ts               loading → start → playing → caught/report
    systems/              sim + frame systems, in execution order
    levels/room01.ts      the v1 room as data
    tone/                 mic → tone-lab's detector (AudioWorklet), keyboard fallback
    language/             word log, grade inference (FSRS in M4)
    run.ts, reset.ts      golden-path phase machine and room reset
    ui/                   HUD, start/pause screens, incident report
test/                     Vitest; todos describe behaviour not built yet
```

## Controls

WASD move · mouse look · Shift sprint (stamina) · C crouch · Space jump · E interact · F flashlight · 1–4 tone keys (no mic) · F3 stats · Esc pause

## Status

- **M1 engine core: done.** Fixed 60 Hz loop with interpolation, input with raw pointer lock, Rapier character (slopes, stairs, crouch headroom, coyote time, jump buffer), WebGPU renderer with WebGL 2 fallback and the post pipeline, procedural audio (HRTF hum per light, footsteps, room reverb), F3 overlay.
- Measured on an NVIDIA Ampere GPU in Chrome: 144 fps (display cap), worst frame 7.1 ms, simulation 0.07 ms, render CPU 0.35 ms, 14 draw calls, on both WebGPU and WebGL 2.
- First load ≈ 1.9 MB gzipped (three 254 kB + Rapier 1.67 MB; the -compat build embeds WASM as base64, a later size win).

- **M2 golden path: done.** Package → sign doors (exit side randomised, 鬼打墙 ghost wall on the wrong one) → knock → 谁？ → answer 我 (third tone, judged by tone-lab's detector live from the mic, or keys 1–4) → lights out, stay quiet (or still) while it hops closer → deliver → incident report with grades and your pitch curve. Played end to end in Chrome through both the mic and keyboard paths.
- Voice lines use the browser's Chinese text-to-speech as a placeholder; subtitles always show hanzi, pinyin and meaning.
- Pipelines are precompiled at load (`renderer.warmup()`); one ~50 ms frame remains at the moment play starts, none during play.

### Rapier 0.21 findings (guarded by tests)

- Auto-step only engages when the requested movement has no downward component: while grounded the character requests zero vertical movement and relies on snap-to-ground.
- Skin widths of 0.02 and 0.06 let the capsule dip into the floor after a fall with snap-to-ground; 0.05 is clean.

## Rules

- Simulation code (sim systems, components) never imports Three.js or touches the DOM. Rendering reads state, never writes it.
- Components are plain serialisable data.
- No allocations in per-frame hot paths.
- Every service and system can be disposed; hot reload calls `engine.dispose()`.
- Each stub says which milestone fills it (M1 engine core, M2 golden path, M3 tone detection, M4 FSRS).
