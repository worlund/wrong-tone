// Bridge between the microphone and gameplay, built on tone-lab's tone-core.
// The simulation polls it once per tick (no promises in sim code):
//   - levelDb: smoothed loudness, for the silence encounter
//   - pollUtterance(): the next judged utterance while listening is on
// In 'keys' mode (no mic), utterances come from the 1–4 keys instead.

import { classifyTone, createSegmenter, createSpeakerModel, extractContour, type PitchFrame } from 'tone-lab/tone-core.js';
import workletUrl from 'tone-lab/pitch-worklet.js?worker&url';

export type ToneNumber = 1 | 2 | 3 | 4;

export interface SpokenSyllable {
  tone: ToneNumber;
  probs: [number, number, number, number];
  /** Pitch contour in semitones (20 points); empty for keyboard answers. */
  contour: number[];
}

export interface Utterance {
  syllables: SpokenSyllable[];
  durationSec: number;
  source: 'mic' | 'keys';
}

export interface ToneInput {
  readonly mode: 'mic' | 'keys';
  /** Smoothed input level in dBFS; -100 without a mic. */
  readonly levelDb: number;
  /** Asks for the microphone; resolves to the resulting mode. Call from a user gesture. */
  requestMic(): Promise<'mic' | 'keys'>;
  /** Only while listening are utterances collected (so speech at other times is ignored). */
  setListening(on: boolean): void;
  /** Ignore the mic until this many seconds from now (our own voice lines are playing). */
  muteFor(seconds: number): void;
  /** Keyboard fallback: an answer with this tone. */
  pushKeyTone(tone: ToneNumber): void;
  pollUtterance(): Utterance | null;
  dispose(): void;
}

const FRAME_SEC = 0.005; // tone-lab's pitch tracker hop
const RELEASE_DB_PER_SEC = 30; // level meter: instant attack, smooth fall
const MAX_SYLLABLE_SEC = 1.6;

export function createToneInput(audio: AudioContext): ToneInput {
  let mode: 'mic' | 'keys' = 'keys';
  let levelDb = -100;
  let listening = false;
  let mutedUntil = 0;
  const queue: Utterance[] = [];
  const segmenter = createSegmenter();
  const speaker = createSpeakerModel(); // learns this player's pitch range from their answers
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;

  const onUtteranceFrames = (frames: PitchFrame[]) => {
    const contour = extractContour(frames);
    if (!contour || contour.duration > MAX_SYLLABLE_SEC) return;
    speaker.add(contour.rawSt);
    const r = classifyTone(contour, speaker.range() ? speaker : null);
    queue.push({
      syllables: [{ tone: (r.best + 1) as ToneNumber, probs: r.probs, contour: contour.st }],
      durationSec: contour.duration,
      source: 'mic',
    });
  };

  // After a mute (or while not listening) the player may already be mid-syllable. Judging from
  // there would see only the syllable's tail (a third tone's rise looks like a second tone),
  // so wait for a quiet frame before accepting the start of a new syllable.
  let needQuiet = true;
  const onFrames = (frames: PitchFrame[]) => {
    for (const f of frames) {
      levelDb = f.db > levelDb ? f.db : Math.max(f.db, levelDb - RELEASE_DB_PER_SEC * FRAME_SEC);
      if (!listening || audio.currentTime < mutedUntil) {
        needQuiet = true;
        continue;
      }
      if (needQuiet) {
        if (f.db > segmenter.gateDb) continue;
        needQuiet = false;
      }
      const utterance = segmenter.push(f);
      if (utterance) onUtteranceFrames(utterance);
    }
  };

  return {
    get mode() {
      return mode;
    },
    get levelDb() {
      return levelDb;
    },
    async requestMic() {
      if (mode === 'mic') return mode;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Call-style processing distorts pitch and loudness; the game needs the raw signal.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        await audio.audioWorklet.addModule(workletUrl);
        node = new AudioWorkletNode(audio, 'pitch-tracker');
        node.port.onmessage = (e: MessageEvent<PitchFrame[]>) => onFrames(e.data);
        const sink = new GainNode(audio, { gain: 0 }); // keeps the worklet pulled without playing the mic
        audio.createMediaStreamSource(stream).connect(node).connect(sink).connect(audio.destination);
        mode = 'mic';
      } catch (err) {
        console.warn('microphone unavailable, using keys 1–4', err);
        mode = 'keys';
      }
      return mode;
    },
    setListening(on) {
      listening = on;
      if (!on) queue.length = 0;
    },
    muteFor(seconds) {
      mutedUntil = Math.max(mutedUntil, audio.currentTime + seconds);
    },
    pushKeyTone(tone) {
      if (!listening) return;
      const probs: [number, number, number, number] = [0, 0, 0, 0];
      probs[tone - 1] = 1;
      queue.push({ syllables: [{ tone, probs, contour: [] }], durationSec: 0, source: 'keys' });
    },
    pollUtterance: () => queue.shift() ?? null,
    dispose() {
      stream?.getTracks().forEach((t) => t.stop());
      node?.disconnect();
    },
  };
}
