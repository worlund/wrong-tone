// Procedural sound for M1: no audio files yet. Listens to 'sound' events from the
// simulation and drives positional fluorescent hum from the light levels.

import type { FrameSystem } from '../../engine/core/system';
import type { SoundHandle } from '../../engine/audio/audio';
import type { Entity } from '../../engine/world/world';
import { FluorescentLight } from '../components';
import type { GameContext } from '../context';

interface Hum {
  handle: SoundHandle;
  volume: number;
  lastLevel: number;
}

export function gameAudio(ctx: GameContext): FrameSystem & { start(): void } {
  const audio = ctx.engine.audio;
  let noise: AudioBuffer | null = null;
  const hums = new Map<Entity, Hum>();
  let started = false;
  let unsubscribe = () => {};

  const burst = (opts: { position?: { x: number; y: number; z: number }; duration: number; lowpass: number; highpass: number; volume: number }) => {
    const c = audio.context;
    const src = new AudioBufferSourceNode(c, { buffer: noise!, playbackRate: 0.8 + Math.random() * 0.4 });
    const hp = new BiquadFilterNode(c, { type: 'highpass', frequency: opts.highpass });
    const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: opts.lowpass * (0.85 + Math.random() * 0.3) });
    const env = new GainNode(c, { gain: 0 });
    const t = c.currentTime;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t + opts.duration);
    src.connect(hp).connect(lp).connect(env);
    audio.route(env, { position: opts.position, volume: opts.volume, bus: 'sfx' });
    src.start(t, Math.random() * 0.8);
    src.stop(t + opts.duration + 0.05);
  };

  /** A pitched body hit: a sine that drops in pitch (knocks, hops, impacts). */
  const thump = (opts: { position?: { x: number; y: number; z: number }; from: number; to: number; duration: number; volume: number; delay?: number }) => {
    const c = audio.context;
    const t = c.currentTime + (opts.delay ?? 0);
    const osc = new OscillatorNode(c, { type: 'sine', frequency: opts.from });
    osc.frequency.setValueAtTime(opts.from, t);
    osc.frequency.exponentialRampToValueAtTime(opts.to, t + opts.duration);
    const env = new GainNode(c, { gain: 0 });
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + opts.duration);
    osc.connect(env);
    audio.route(env, { position: opts.position, volume: opts.volume, bus: 'sfx' });
    osc.start(t);
    osc.stop(t + opts.duration + 0.05);
  };

  /** A slow filtered-noise sweep (door creak, electrical drone). */
  const sweep = (opts: { position?: { x: number; y: number; z: number }; from: number; to: number; duration: number; volume: number; q: number }) => {
    const c = audio.context;
    const t = c.currentTime;
    const src = new AudioBufferSourceNode(c, { buffer: noise!, loop: true });
    const band = new BiquadFilterNode(c, { type: 'bandpass', frequency: opts.from, Q: opts.q });
    band.frequency.setValueAtTime(opts.from, t);
    band.frequency.exponentialRampToValueAtTime(opts.to, t + opts.duration);
    const env = new GainNode(c, { gain: 0 });
    env.gain.linearRampToValueAtTime(1, t + 0.1);
    env.gain.setValueAtTime(1, t + opts.duration * 0.7);
    env.gain.linearRampToValueAtTime(0, t + opts.duration);
    src.connect(band).connect(env);
    audio.route(env, { position: opts.position, volume: opts.volume, bus: 'sfx' });
    src.start(t);
    src.stop(t + opts.duration + 0.05);
  };

  const onSound = (cue: string, position?: { x: number; y: number; z: number }) => {
    if (!noise) return;
    switch (cue) {
      case 'footstep': return burst({ position, duration: 0.11, lowpass: 700, highpass: 70, volume: 0.55 });
      case 'footstepRun': return burst({ position, duration: 0.13, lowpass: 900, highpass: 60, volume: 0.8 });
      case 'footstepSoft': return burst({ position, duration: 0.09, lowpass: 450, highpass: 80, volume: 0.3 });
      case 'land': return burst({ position, duration: 0.22, lowpass: 380, highpass: 40, volume: 1 });
      case 'flickerClick': return burst({ position, duration: 0.03, lowpass: 6000, highpass: 1500, volume: 0.25 });
      case 'click': return burst({ duration: 0.025, lowpass: 5000, highpass: 1800, volume: 0.35 });
      case 'pickup': return burst({ duration: 0.12, lowpass: 1600, highpass: 300, volume: 0.5 });
      case 'knock':
        for (const [i, delay] of [0, 0.32, 0.6].entries()) {
          thump({ position, from: 190 - i * 8, to: 90, duration: 0.12, volume: 1.2, delay });
        }
        return;
      case 'doorRattle':
        for (const delay of [0, 0.09, 0.17, 0.28]) setTimeout(() => burst({ position, duration: 0.05, lowpass: 3500, highpass: 600, volume: 0.7 }), delay * 1000);
        return;
      case 'creak': return sweep({ position, from: 380, to: 900, duration: 1.8, volume: 0.6, q: 18 });
      case 'lightsOut':
        thump({ from: 70, to: 35, duration: 0.5, volume: 1.4 });
        return burst({ duration: 0.08, lowpass: 8000, highpass: 2000, volume: 0.6 });
      case 'hop': return thump({ position, from: 85, to: 40, duration: 0.35, volume: 2.2 });
      case 'retreat': return thump({ position, from: 60, to: 30, duration: 0.6, volume: 0.6 });
      case 'caughtSting':
        thump({ from: 55, to: 25, duration: 1.4, volume: 3 });
        return sweep({ from: 2400, to: 300, duration: 1.2, volume: 1.2, q: 3 });
    }
  };

  const startHum = (e: Entity, x: number, y: number, z: number) => {
    const c = audio.context;
    // Mains-frequency ballast buzz: 120 Hz sawtooth plus harmonics, band-limited.
    const saw = new OscillatorNode(c, { type: 'sawtooth', frequency: 120 });
    const sine = new OscillatorNode(c, { type: 'sine', frequency: 240 });
    const mix = new GainNode(c, { gain: 1 });
    const sineGain = new GainNode(c, { gain: 0.6 });
    const band = new BiquadFilterNode(c, { type: 'lowpass', frequency: 900, Q: 0.7 });
    saw.connect(mix);
    sine.connect(sineGain).connect(mix);
    mix.connect(band);
    const handle = audio.route(band, { position: { x, y, z }, volume: 0, bus: 'ambience', refDistance: 0.8 });
    const stopAll = handle.stop;
    saw.start();
    sine.start();
    hums.set(e, {
      handle: { ...handle, stop: (fade) => { stopAll(fade); saw.stop(); sine.stop(); } },
      volume: 0.035,
      lastLevel: 1,
    });
  };

  return {
    name: 'audio',
    start() {
      if (started) return;
      started = true;
      const c = audio.context;
      noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      unsubscribe = ctx.engine.events.on('sound', (ev) => onSound(ev.cue, ev.position));
      for (const [e, v] of ctx.level.lights) startHum(e, v.light.position.x, v.light.position.y, v.light.position.z);

      // Room tone: very quiet low rumble so silence is never digital silence.
      const room = new AudioBufferSourceNode(c, { buffer: noise, loop: true });
      const lp = new BiquadFilterNode(c, { type: 'lowpass', frequency: 160 });
      room.connect(lp);
      audio.route(lp, { volume: 0.05, bus: 'ambience' });
      room.start();
    },
    frameUpdate(world) {
      const t = audio.context.currentTime;
      for (const [e, hum] of hums) {
        const level = world.require(e, FluorescentLight).level;
        hum.handle.gain.gain.setTargetAtTime(hum.volume * level, t, 0.005);
        if (hum.lastLevel > 0.5 && level < 0.5) {
          const p = ctx.level.lights.get(e)!.light.position;
          onSound('flickerClick', { x: p.x, y: p.y, z: p.z });
        }
        hum.lastLevel = level;
      }
    },
    dispose() {
      unsubscribe();
      for (const hum of hums.values()) hum.handle.stop(0.1);
      hums.clear();
    },
  };
}
