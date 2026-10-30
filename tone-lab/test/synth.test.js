// Runs synthetic "voices" through the full pipeline: tracker -> segmenter -> contour -> classifier.
// This checks the code, not real-world accuracy: real voices are messier. Tune with exported mic data.
import {
  createPitchTracker, createSegmenter, extractContour, createSpeakerModel,
  classifyTone, hzToSt, stToHz, templateCurve, TONE_NAMES,
} from '../tone-core.js';

const SR = 48000;
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const between = (a, b) => a + rand() * (b - a);

// Citation tones on the Chao scale (time, level).
const NATIVE = [
  { pts: [[0, 5], [1, 5]], dur: 0.38 },
  { pts: [[0, 3], [0.25, 2.8], [1, 5]], dur: 0.42 },
  { pts: [[0, 2], [0.5, 1], [0.7, 1], [1, 4]], dur: 0.52 },
  { pts: [[0, 5], [1, 1]], dur: 0.32 },
];
// Learners: smaller pitch movements, sloppy third tone (low, half-dip).
const LEARNER = [
  { pts: [[0, 4.4], [1, 4.1]], dur: 0.4 },
  { pts: [[0, 3], [1, 4.3]], dur: 0.45 },
  { pts: [[0, 2.4], [0.6, 1.3], [1, 1.6]], dur: 0.45 },
  { pts: [[0, 4.4], [1, 2.4]], dur: 0.35 },
];

const SPEAKERS = [
  { name: 'low voice', lo: 85, hi: 165 },
  { name: 'mid voice', lo: 120, hi: 230 },
  { name: 'high voice', lo: 175, hi: 340 },
];

function synth(contourHz, dur, { noiseDb = -55, onsetNoise = false, edges = null } = {}) {
  const pad = 0.3;
  const n = Math.round((dur + 2 * pad) * SR);
  const out = new Float32Array(n);
  const noiseAmp = 10 ** (noiseDb / 20);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR - pad;
    let s = (rand() * 2 - 1) * noiseAmp;
    if (t >= 0 && t <= dur) {
      let f = contourHz(t / dur);
      if (edges) {
        // Real syllable edges: F0 starts raised after a voiceless consonant,
        // and sags as the voice fades out at the end.
        if (onsetNoise) f *= 2 ** ((edges.onsetSt * Math.exp(-t / 0.02)) / 12);
        const tail = Math.max(0, (t - (dur - 0.07)) / 0.07);
        f *= 2 ** ((-edges.offsetSt * tail * tail) / 12);
      }
      phase += (2 * Math.PI * f) / SR;
      const env = Math.min(1, t / 0.03, ((dur - t) / (edges ? 0.09 : 0.05)) ** (edges ? 1.5 : 1));
      let v = 0;
      for (let k = 1; k <= 12; k++) v += Math.sin(k * phase) / k;
      s += 0.15 * env * v;
    } else if (onsetNoise && t < 0 && t > -0.05) {
      s += (rand() * 2 - 1) * 0.05; // fricative-ish onset like "sh"/"x"
    }
    out[i] = s;
  }
  return out;
}

function run(samples) {
  const tracker = createPitchTracker({ sampleRate: SR });
  const seg = createSegmenter();
  const utterances = [];
  const block = 128;
  for (let i = 0; i < samples.length; i += block) {
    for (const f of tracker.push(samples.subarray(i, i + block))) {
      const u = seg.push(f);
      if (u) utterances.push(u);
    }
  }
  return utterances;
}

function evaluate(label, specs, { speed = 1, trials = 12, realistic = false } = {}) {
  const matrix = TONE_NAMES.map(() => [0, 0, 0, 0, 0]); // last column: no detection
  let pitchErrCents = [];

  for (const sp of SPEAKERS) {
    const loSt = hzToSt(sp.lo), hiSt = hzToSt(sp.hi);
    const speaker = createSpeakerModel();
    const cases = [];
    for (let k = 0; k < trials; k++) for (let tone = 0; tone < 4; tone++) cases.push(tone);

    for (const tone of cases) {
      const spec = specs[tone];
      const scale = between(0.75, 1.15); // how far this attempt moves
      const shift = between(-0.4, 0.4); // where it sits in the range
      const curve = templateCurve(spec.pts, 200);
      const mid = 3;
      const jitter = between(0, 2 * Math.PI);
      const hz = (x) => {
        const chao = mid + (curve[Math.min(199, Math.floor(x * 199))] - mid) * scale + shift;
        const st = loSt + ((chao - 1) / 4) * (hiSt - loSt) + 0.15 * Math.sin(jitter + x * 25);
        return stToHz(st);
      };
      const dur = (spec.dur * between(0.85, 1.2)) / speed;
      const edges = realistic ? { onsetSt: between(1.5, 3.5), offsetSt: between(1, 4) } : null;
      const audio = synth(hz, dur, { onsetNoise: rand() < 0.5 || realistic, edges });
      const utts = run(audio);
      const frames = utts.sort((a, b) => b.length - a.length)[0];
      const contour = frames && extractContour(frames);
      if (!contour) { matrix[tone][4]++; continue; }

      // Pitch accuracy at the middle of the vowel.
      const midF = frames[frames.length >> 1];
      const x = (midF.t - 0.3) / dur;
      if (x > 0.1 && x < 0.9) pitchErrCents.push(Math.abs(1200 * Math.log2(midF.f0 / hz(x))));

      speaker.add(contour.rawSt);
      const r = classifyTone(contour, speaker.range() ? speaker : null);
      matrix[tone][r.best]++;
    }
  }

  const total = matrix.flat().reduce((a, b) => a + b, 0);
  const correct = matrix.reduce((s, row, i) => s + row[i], 0);
  pitchErrCents.sort((a, b) => a - b);
  console.log(`\n${label}: ${((100 * correct) / total).toFixed(1)}% correct (${correct}/${total})`);
  console.log(`  median pitch error: ${pitchErrCents[pitchErrCents.length >> 1]?.toFixed(1)} cents`);
  console.log('  actual \\ predicted   T1   T2   T3   T4  none');
  matrix.forEach((row, i) =>
    console.log(`  ${TONE_NAMES[i]}                  ${row.map((v) => String(v).padStart(4)).join(' ')}`));
  return correct / total;
}

const native = evaluate('Native-like citation tones', NATIVE);
const learner = evaluate('Learner-like tones (compressed, half third tone)', LEARNER);
// Normal speaking speed: syllables of roughly 150-250 ms.
const nativeFast = evaluate('Native-like, normal speed', NATIVE, { speed: 2.2 });
const learnerFast = evaluate('Learner-like, normal speed', LEARNER, { speed: 2.2 });
// Realistic edges: raised F0 after consonants, sagging F0 as the voice fades.
const nativeReal = evaluate('Native-like, normal speed, realistic edges', NATIVE, { speed: 2.2, realistic: true });
const learnerReal = evaluate('Learner-like, normal speed, realistic edges', LEARNER, { speed: 2.2, realistic: true });
const slowReal = evaluate('Learner-like, slow, realistic edges', LEARNER, { realistic: true });
if ([native, nativeFast, nativeReal].some((a) => a < 0.9) || [learner, learnerFast, learnerReal, slowReal].some((a) => a < 0.8)) {
  console.error('\nFAIL: accuracy below threshold (native >= 90%, learner >= 80%, at both speeds)');
  process.exit(1);
}
console.log('\nPASS');
