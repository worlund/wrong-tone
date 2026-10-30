import { Engine } from './engine/engine';
import { CharacterBody } from './engine/physics/character';
import { startVoice } from './game/audio/voice';
import { Player } from './game/components';
import type { GameContext } from './game/context';
import type { GameEvents } from './game/events';
import { GameFlow } from './game/flow';
import { WordLog } from './game/language/wordLog';
import { buildLevel } from './game/levels/build';
import { ROOM_01 } from './game/levels/room01';
import { resetRun } from './game/reset';
import { freshRun, Run } from './game/run';
import { createSystems } from './game/systems';
import { createToneInput } from './game/tone/toneInput';
import { hudSystem } from './game/ui/hud';
import { showReport } from './game/ui/report';
import { Screens } from './game/ui/screens';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const ui = document.querySelector<HTMLElement>('#ui')!;
const screens = new Screens(ui);
const engine = new Engine<GameEvents>({ canvas, uiRoot: ui });
const flow = new GameFlow();

screens.loading('Starting…');
try {
  await engine.init((name) => screens.loading(`Starting ${name}…`));
} catch (err) {
  console.error(err);
  screens.error('Your browser could not start WebGPU or WebGL 2. Try an up-to-date Chrome, Edge or Firefox.');
  throw err;
}

// Level, player, run state, language log, microphone.
const level = buildLevel(ROOM_01, engine);
const character = new CharacterBody(engine.physics);
const player = engine.world.createEntity();
engine.world.add(player, Player, {
  character: character.spawn(ROOM_01.spawn),
  yaw: ROOM_01.spawnYaw, pitch: 0, stamina: 1, sprintLocked: false, sprinting: false,
  jumpBuffer: 0, stride: 0, carrying: null, flashlight: false,
});
const run = engine.world.createEntity();
engine.world.add(run, Run, freshRun());
const words = new WordLog();
words.listen(engine.events);
const tone = createToneInput(engine.audio.context);

const ctx: GameContext = {
  engine, flow, character, player, run, level, tone, words,
  settings: { headBob: true, sprintFovKick: 5 },
};
const systems = createSystems(ctx);
systems.sim.forEach((s) => engine.addSimSystem(s));
systems.frame.forEach((s) => engine.addFrameSystem(s));
engine.addFrameSystem(hudSystem(ctx));
startVoice(ctx);
resetRun(ctx, { newShift: true });
screens.loading('Preparing the room…');
await engine.renderer.warmup();

// Pause is separate from the flow: Esc (losing pointer lock) pauses any state.
let paused = true;
const updatePaused = () => {
  engine.loop.paused = paused || flow.state === 'report' || flow.state === 'start';
};
engine.start();
flow.go('start');
updatePaused();

let micAsked = false;
const begin = async () => {
  await engine.audio.unlock();
  systems.audio.start();
  if (!micAsked) {
    micAsked = true;
    screens.start('Wrong Tone', 'Allow the microphone to answer with your voice (headphones recommended)…', () => {});
    await tone.requestMic();
  }
  try {
    await engine.input.requestPointerLock();
  } catch {
    // The mic prompt or Chrome's re-lock cooldown used up the click; ask for another.
    const text = tone.mode === 'mic' ? 'Microphone on. Click to begin.' : 'No microphone: answer tones with keys 1–4. Click to begin.';
    screens.start('Ready', text, begin);
  }
};

engine.input.onLockChange((locked) => {
  paused = !locked;
  if (locked) {
    if (flow.state === 'start') flow.go('playing');
    screens.hide();
  } else if (flow.state !== 'report') {
    screens.start('Paused', 'Click to resume', begin);
  }
  updatePaused();
});

engine.events.on('caught', () => flow.go('caught'));
engine.events.on('runReset', () => {
  if (flow.state === 'caught') flow.go('playing');
});
engine.events.on('delivered', () => {
  setTimeout(() => {
    flow.go('report');
    updatePaused();
    document.exitPointerLock();
    showReport(ui, words, engine.world.require(run, Run), () => {
      resetRun(ctx, { newShift: true });
      flow.go('playing');
      void begin();
    });
  }, 2500);
});

screens.start(
  'Wrong Tone',
  'Click to start · WASD move · Shift sprint · C crouch · E interact · F flashlight · F3 stats',
  begin,
);

if (import.meta.env.DEV) {
  // Handle for automated browser checks and console debugging.
  Object.assign(window, { __wt: { engine, flow, ctx, resetRun } });
}
if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose());
