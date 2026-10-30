// Learns a tone classifier from real recordings (eval/out/features.json, made by
// `node eval/evaluate.mjs --dump`) and compares it with the hand-tuned templates.
//   node eval/fit.mjs           leave-one-speaker-out evaluation
//   node eval/fit.mjs --write   also trains on everyone and writes tone-model.js
import fs from 'node:fs';
import { classifyTone, TONE_NAMES } from '../tone-core.js';
import { toneFeatures, FEATURE_NAMES } from '../tone-features.js';

const rows = JSON.parse(fs.readFileSync('eval/out/features.json', 'utf8'));
const write = process.argv.includes('--write');

// Learners move their pitch less than natives and sit at odd heights in their range.
// Train on native contours plus shrunken / shifted copies so the model accepts that.
function augment(r) {
  const out = [r];
  for (const g of [0.5, 0.7]) {
    const m = r.st.reduce((a, b) => a + b, 0) / r.st.length;
    for (const shift of [-0.4, 0, 0.4]) {
      out.push({ ...r, st: r.st.map((v) => m + (v - m) * g), meanChao: r.meanChao == null ? null : r.meanChao + shift });
    }
  }
  return out;
}

function train(data, { epochs = 400, lr = 0.1, l2 = 1e-3 } = {}) {
  const X = data.map((r) => toneFeatures(r));
  const y = data.map((r) => r.tone - 1);
  const d = X[0].length;
  // Standardise features.
  const mu = Array(d).fill(0), sd = Array(d).fill(0);
  for (const x of X) x.forEach((v, j) => (mu[j] += v / X.length));
  for (const x of X) x.forEach((v, j) => (sd[j] += (v - mu[j]) ** 2 / X.length));
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]) / sd[j]));
  // Class weights: tones are not equally common in the data.
  const counts = [0, 0, 0, 0];
  y.forEach((c) => counts[c]++);
  const cw = counts.map((c) => y.length / (4 * Math.max(1, c)));

  const W = [0, 1, 2, 3].map(() => Array(d + 1).fill(0));
  for (let e = 0; e < epochs; e++) {
    const grad = W.map((w) => w.map(() => 0));
    for (let i = 0; i < Z.length; i++) {
      const p = softmax(W.map((w) => dot(w, Z[i])));
      for (let k = 0; k < 4; k++) {
        const err = (p[k] - (y[i] === k ? 1 : 0)) * cw[y[i]];
        for (let j = 0; j < d; j++) grad[k][j] += err * Z[i][j];
        grad[k][d] += err;
      }
    }
    for (let k = 0; k < 4; k++) for (let j = 0; j <= d; j++) {
      W[k][j] -= lr * (grad[k][j] / Z.length + (j < d ? l2 * W[k][j] : 0));
    }
  }
  return { mu, sd, W };
}

function predict(model, r) {
  const z = toneFeatures(r).map((v, j) => (v - model.mu[j]) / model.sd[j]);
  return softmax(model.W.map((w) => dot(w, z)));
}

const dot = (w, z) => z.reduce((s, v, j) => s + v * w[j], w[z.length]);
function softmax(a) {
  const m = Math.max(...a);
  const e = a.map((v) => Math.exp(v - m));
  const s = e.reduce((x, y) => x + y, 0);
  return e.map((v) => v / s);
}

// Template baseline uses the same contour and speaker range.
function templatePredict(r) {
  const speaker = r.range ? { toChao: (st) => 1 + (4 * (st - r.range.lo)) / (r.range.hi - r.range.lo) } : null;
  return classifyTone({ st: r.st, duration: r.duration, creak: r.creak }, speaker).probs;
}

// Learner-like test copies: natives with half the pitch movement.
const shrink = (r) => {
  const m = r.st.reduce((a, b) => a + b, 0) / r.st.length;
  return { ...r, st: r.st.map((v) => m + (v - m) * 0.55) };
};

const speakers = [...new Set(rows.map((r) => r.speaker))];
const tally = () => ({ ok: 0, n: 0, m: TONE_NAMES.map(() => [0, 0, 0, 0]) });
const res = { model: tally(), template: tally(), modelShrunk: tally(), templateShrunk: tally() };
const add = (t, r, probs) => {
  const best = probs.indexOf(Math.max(...probs));
  t.n++; t.m[r.tone - 1][best]++;
  if (best === r.tone - 1) t.ok++;
};

console.log(`${rows.length} recordings from ${speakers.length} speakers; features: ${FEATURE_NAMES.length}`);
for (const held of speakers) {
  const test = rows.filter((r) => r.speaker === held);
  const trainSet = rows.filter((r) => r.speaker !== held).flatMap(augment);
  if (test.length < 5 || trainSet.length < 50) continue;
  const model = train(trainSet);
  const before = res.model.ok;
  for (const r of test) {
    add(res.model, r, predict(model, r));
    add(res.template, r, templatePredict(r));
    add(res.modelShrunk, r, predict(model, shrink(r)));
    add(res.templateShrunk, r, templatePredict(shrink(r)));
  }
  console.log(`  held out ${held.padEnd(30)} n=${String(test.length).padStart(3)}  model ${((100 * (res.model.ok - before)) / test.length).toFixed(0)}%`);
}

const pct = (t) => `${((100 * t.ok) / t.n).toFixed(1)}%`;
console.log('\nLeave-one-speaker-out accuracy');
console.log(`  native recordings:          templates ${pct(res.template)}   learned model ${pct(res.model)}`);
console.log(`  learner-like (55% movement): templates ${pct(res.templateShrunk)}   learned model ${pct(res.modelShrunk)}`);
for (const [name, t] of [['templates', res.template], ['learned model', res.model]]) {
  console.log(`\n  ${name}: actual \\ predicted   T1   T2   T3   T4`);
  t.m.forEach((row, i) => console.log(`    ${TONE_NAMES[i]}                       ${row.map((v) => String(v).padStart(4)).join(' ')}`));
}

if (write) {
  const model = train(rows.flatMap(augment));
  const round = (v) => +v.toFixed(5);
  const src = `// Generated by eval/fit.mjs from ${rows.length} native recordings (${speakers.length} speakers). Do not edit.\n` +
    `export const TONE_MODEL = ${JSON.stringify({
      features: FEATURE_NAMES, mu: model.mu.map(round), sd: model.sd.map(round), W: model.W.map((w) => w.map(round)),
    })};\n`;
  fs.writeFileSync('tone-model.js', src);
  console.log('\nWrote tone-model.js');
}
