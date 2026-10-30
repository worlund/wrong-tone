// One AudioContext for the whole game, unlocked by the start click.
// Buses: master → (sfx, ambience, voice). 3D sources use HRTF PannerNodes
// whose listener follows the camera every frame. A short generated room
// reverb sits on a send from sfx and ambience.

import type { Service } from '../core/system';
import type { Vec3 } from '../physics/physics';

export type Bus = 'sfx' | 'ambience' | 'voice';

export interface PlayOptions {
  bus?: Bus;
  volume?: number;
  loop?: boolean;
  playbackRate?: number;
  /** World position for HRTF panning; omit for 2D (UI, radio). */
  position?: Vec3;
  /** Distance at which the sound starts to fall off (metres). */
  refDistance?: number;
}

export interface SoundHandle {
  readonly gain: GainNode;
  stop(fadeSeconds?: number): void;
  setPosition(p: Vec3): void;
}

export class AudioEngine implements Service {
  readonly name = 'audio';
  context!: AudioContext;
  master!: GainNode;
  private buses = new Map<Bus, GainNode>();
  private reverbSend!: GainNode;
  private cache = new Map<string, Promise<AudioBuffer | null>>();

  init(): void {
    const ctx = (this.context = new AudioContext({ latencyHint: 'interactive' }));
    this.master = new GainNode(ctx, { gain: 0.9 });
    this.master.connect(ctx.destination);
    for (const bus of ['sfx', 'ambience', 'voice'] as const) {
      const g = new GainNode(ctx);
      g.connect(this.master);
      this.buses.set(bus, g);
    }
    const reverb = new ConvolverNode(ctx, { buffer: roomImpulse(ctx, 0.7) });
    this.reverbSend = new GainNode(ctx, { gain: 0.18 });
    this.reverbSend.connect(reverb).connect(this.master);
    this.bus('sfx').connect(this.reverbSend);
    this.bus('ambience').connect(this.reverbSend);
  }

  bus(name: Bus): GainNode {
    return this.buses.get(name)!;
  }

  /** Must be called from a user gesture (the start click). */
  async unlock(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume();
  }

  /** Fetches and decodes once; decoded buffers are cached and reused. */
  load(url: string): Promise<AudioBuffer | null> {
    let p = this.cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${url}`))))
        .then((data) => this.context.decodeAudioData(data))
        .catch((err) => {
          console.warn('audio load failed', err);
          return null;
        });
      this.cache.set(url, p);
    }
    return p;
  }

  /** A new source node per play (source nodes are one-shot). */
  play(buffer: AudioBuffer, options: PlayOptions = {}): SoundHandle {
    const src = new AudioBufferSourceNode(this.context, {
      buffer,
      loop: options.loop ?? false,
      playbackRate: options.playbackRate ?? 1,
    });
    const handle = this.route(src, options);
    src.start();
    return handle;
  }

  /** Routes any source node (oscillators, procedural graphs) through volume, panning and a bus. */
  route(source: AudioNode & { stop?: (when?: number) => void }, options: PlayOptions = {}): SoundHandle {
    const ctx = this.context;
    const gain = new GainNode(ctx, { gain: options.volume ?? 1 });
    let panner: PannerNode | null = null;
    source.connect(gain);
    if (options.position) {
      panner = new PannerNode(ctx, {
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: options.refDistance ?? 1,
        maxDistance: 40,
        rolloffFactor: 1.2,
      });
      setPannerPosition(panner, options.position, ctx.currentTime);
      gain.connect(panner).connect(this.bus(options.bus ?? 'sfx'));
    } else {
      gain.connect(this.bus(options.bus ?? 'sfx'));
    }
    return {
      gain,
      stop: (fade = 0) => {
        const t = ctx.currentTime;
        gain.gain.setTargetAtTime(0, t, Math.max(0.001, fade / 3));
        source.stop?.(t + fade + 0.05);
      },
      setPosition: (p) => panner && setPannerPosition(panner, p, ctx.currentTime),
    };
  }

  setListener(position: Vec3, forward: Vec3, up: Vec3): void {
    const l = this.context.listener;
    const t = this.context.currentTime;
    if (l.positionX) {
      // Short time constant: smooth enough to avoid zipper noise, fast enough to track the camera.
      l.positionX.setTargetAtTime(position.x, t, 0.01);
      l.positionY.setTargetAtTime(position.y, t, 0.01);
      l.positionZ.setTargetAtTime(position.z, t, 0.01);
      l.forwardX.setTargetAtTime(forward.x, t, 0.01);
      l.forwardY.setTargetAtTime(forward.y, t, 0.01);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.01);
      l.upX.setTargetAtTime(up.x, t, 0.01);
      l.upY.setTargetAtTime(up.y, t, 0.01);
      l.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      // Older Firefox: deprecated setters only.
      l.setPosition(position.x, position.y, position.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  dispose(): void {
    void this.context?.close();
  }
}

function setPannerPosition(p: PannerNode, v: Vec3, t: number): void {
  p.positionX.setTargetAtTime(v.x, t, 0.01);
  p.positionY.setTargetAtTime(v.y, t, 0.01);
  p.positionZ.setTargetAtTime(v.z, t, 0.01);
}

/** Small-room impulse response: exponentially decaying stereo noise. */
function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.5);
  }
  return buf;
}
