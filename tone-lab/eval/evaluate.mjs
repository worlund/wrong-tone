// Runs real recordings through the same pipeline the browser uses and reports accuracy.
//   node eval/evaluate.mjs [--range calibrated|online] [--dump]
// --range calibrated: each speaker's pitch range is known up front (like after calibration).
// --range online:     the range is learned attempt by attempt, like a fresh session in the app.
// --dump:             writes eval/out/features.json (contours + labels) for fitting the classifier.
import fs from 'node:fs';
import path from 'node:path';
import {
  createPitchTracker, createSegmenter, extractContour, createSpeakerModel, classifyTone, TONE_NAMES,
} from '../tone-core.js';
import { decodeWav } from './wav.js';

const DATA = path.resolve('data/lingualibre');
const args = process.argv.slice(2);
const rangeMode = args.includes('--range') ? args[args.indexOf('--range') + 1] : 'calibrated';
const dump = args.includes('--dump');

const manifest = JSON.parse(fs.readFileSync(path.join(DATA, 'manifest.json'), 'utf8'));

// Same processing as the browser: pitch frames -> segmenter -> longest utterance -> contour.
export function contourFromAudio({ samples, sampleRate }) {
  // Recording levels vary a lot between volunteers; normalise the peak so the
  // noise gate behaves the same for everyone (the app has a gate slider for this).
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.5 / peak : 1;
  const scaled = samples.map((s) => s * gain);
  // Pad with silence so a recording that ends mid-vowel still closes the segment.
  const padded = new Float32Array(scaled.length + sampleRate);
  padded.set(scaled);

  const tracker = createPitchTracker({ sampleRate });
  const seg = createSegmenter();
  const utterances = [];
  for (let i = 0; i < padded.length; i += 128) {
    for (const f of tracker.push(padded.subarray(i, i + 128))) {
      const u = seg.push(f);
      if (u) utterances.push(u);
    }
  }
  const frames = utterances.sort((a, b) => b.length - a.length)[0];
  return frames ? extractContour(frames) : null;
}

const items = [];
let decodeErrors = 0;
for (const m of manifest) {
  try {
    const audio = decodeWav(fs.readFileSync(path.join(DATA, m.file)));
    items.push({ ...m, contour: contourFromAudio(audio) });
  } catch {
    decodeErrors++;
  }
}

// Speaker ranges.
const bySpeaker = {};
for (const it of items) (bySpeaker[it.speaker] ||= []).push(it);
const models = {};
for (const [spk, list] of Object.entries(bySpeaker)) {
  const model = createSpeakerModel();
  if (rangeMode === 'calibrated') for (const it of list) if (it.contour) model.add(it.contour.rawSt);
  models[spk] = model;
}

const matrix = TONE_NAMES.map(() => [0, 0, 0, 0, 0]);
const perSpeaker = {};
const failures = [];
const features = [];
for (const it of items) {
  const s = (perSpeaker[it.speaker] ||= { n: 0, ok: 0, none: 0 });
  s.n++;
  const target = it.tone - 1;
  if (!it.contour) { matrix[target][4]++; s.none++; continue; }
  const model = models[it.speaker];
  if (rangeMode === 'online') model.add(it.contour.rawSt);
  const r = classifyTone(it.contour, model.range() ? model : null);
  matrix[target][r.best]++;
  if (r.best === target) s.ok++;
  else failures.push({ file: it.file, char: it.char, pinyin: it.pinyin, heard: TONE_NAMES[r.best], probs: r.probs.map((p) => +p.toFixed(2)) });
  if (dump) {
    const range = model.range();
    features.push({
      speaker: it.speaker, char: it.char, tone: it.tone,
      st: it.contour.st, duration: it.contour.duration, creak: it.contour.creak,
      range, meanChao: r.meanChao,
    });
  }
}

const judged = matrix.reduce((s, row) => s + row.slice(0, 4).reduce((a, b) => a + b, 0), 0);
const correct = matrix.reduce((s, row, i) => s + row[i], 0);
const none = matrix.reduce((s, row) => s + row[4], 0);
console.log(`Recordings: ${items.length} (decode errors: ${decodeErrors}), range mode: ${rangeMode}`);
console.log(`Accuracy: ${((100 * correct) / judged).toFixed(1)}% of ${judged} judged; ${none} not detected`);
console.log('  actual \\ predicted   T1   T2   T3   T4  none');
matrix.forEach((row, i) => console.log(`  ${TONE_NAMES[i]}                  ${row.map((v) => String(v).padStart(4)).join(' ')}`));
console.log('\nPer speaker:');
for (const [spk, s] of Object.entries(perSpeaker).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${spk.padEnd(32)} ${String(s.n).padStart(4)} recordings  ${((100 * s.ok) / Math.max(1, s.n - s.none)).toFixed(0).padStart(3)}%  (${s.none} not detected)`);
}

fs.mkdirSync('eval/out', { recursive: true });
fs.writeFileSync('eval/out/failures.json', JSON.stringify(failures, null, 1));
if (dump) fs.writeFileSync('eval/out/features.json', JSON.stringify(features));
