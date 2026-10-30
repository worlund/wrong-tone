// Tone detection core: pitch tracking (YIN), utterance segmentation,
// contour extraction and Mandarin tone classification.
// Pure JS with no browser APIs, so it runs in an AudioWorklet, the page and Node tests.

export const TONE_NAMES = ['T1', 'T2', 'T3', 'T4'];

// ---------------------------------------------------------------------------
// Pitch tracker
// ---------------------------------------------------------------------------

export function createPitchTracker({
  sampleRate,
  fmin = 65,
  fmax = 500,
  threshold = 0.2,
  hopSec = 0.005,
  windowSec = 0.025,
} = {}) {
  // Decimate to ~11-12 kHz: plenty for F0 <= 500 Hz, and ~16x cheaper YIN.
  const factor = Math.max(1, Math.floor(sampleRate / 11000));
  const sr = sampleRate / factor;
  const lp = [biquadLowpass(sampleRate, 1800), biquadLowpass(sampleRate, 1800)];

  let tauMin = 1, tauMax = 1, W = 1, hop = 1, buf, bufLen = 0, sinceHop = 0, decimPhase = 0;
  let time = 0;

  function configure(opts = {}) {
    if (opts.fmin) fmin = opts.fmin;
    if (opts.fmax) fmax = opts.fmax;
    if (opts.threshold) threshold = opts.threshold;
    tauMin = Math.max(2, Math.floor(sr / fmax));
    tauMax = Math.ceil(sr / fmin);
    W = Math.round(sr * windowSec);
    hop = Math.round(sr * hopSec);
    buf = new Float32Array(W + tauMax + 2);
    bufLen = 0;
  }
  configure();

  const d = new Float32Array(1024);

  function yin(x) {
    // Difference function + cumulative mean normalisation.
    let running = 0;
    d[0] = 1;
    let bestTau = -1;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const v = x[j] - x[j + tau];
        s += v * v;
      }
      running += s;
      d[tau] = running > 0 ? (s * tau) / running : 1;
    }
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        bestTau = tau;
        break;
      }
    }
    if (bestTau < 0) return { f0: 0, clarity: 0 };
    // Parabolic interpolation around the minimum.
    let t = bestTau;
    if (t > 1 && t < tauMax) {
      const a = d[t - 1], b = d[t], c = d[t + 1];
      const denom = a - 2 * b + c;
      if (denom !== 0) t += (0.5 * (a - c)) / denom;
    }
    return { f0: sr / t, clarity: 1 - d[bestTau] };
  }

  // Feed raw samples; returns an array of frames ({t, f0, clarity, db}).
  function push(samples) {
    const frames = [];
    for (let i = 0; i < samples.length; i++) {
      const y = lp[1](lp[0](samples[i]));
      if (++decimPhase < factor) continue;
      decimPhase = 0;

      if (bufLen < buf.length) buf[bufLen++] = y;
      else {
        buf.copyWithin(0, 1);
        buf[buf.length - 1] = y;
      }
      time += 1 / sr;

      if (++sinceHop >= hop && bufLen === buf.length) {
        sinceHop = 0;
        // Energy of the same (low-passed) span YIN analyses, so both line up in time.
        // Low-passing also keeps fricative hiss from counting as voice.
        let e = 0;
        for (let j = 0; j < buf.length; j++) e += buf[j] * buf[j];
        const rms = Math.sqrt(e / buf.length);
        const { f0, clarity } = yin(buf);
        // Timestamp the centre of the analysed span, not its end.
        const t = time - (W + tauMax) / 2 / sr;
        frames.push({ t, f0, clarity, db: 20 * Math.log10(rms + 1e-9) });
      }
    }
    return frames;
  }

  return { push, configure, get decimatedRate() { return sr; } };
}

function biquadLowpass(fs, fc, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * fc) / fs;
  const alpha = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0;
  const a1 = (-2 * cw) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

// ---------------------------------------------------------------------------
// Utterance segmentation
// ---------------------------------------------------------------------------

// Ends an utterance on sustained silence, not on unvoiced frames alone:
// third tones often go creaky (no clean pitch) in the middle.
export function createSegmenter({
  gateDb = -45,
  frameSec = 0.005,
  startSec = 0.03,
  silenceSec = 0.2,
  unvoicedSec = 0.35,
  maxSec = 2.5,
} = {}) {
  const startFrames = Math.round(startSec / frameSec);
  const silenceFrames = Math.round(silenceSec / frameSec);
  const unvoicedFrames = Math.round(unvoicedSec / frameSec);
  const maxFrames = Math.round(maxSec / frameSec);
  let active = false, frames = [], voicedRun = 0, quietRun = 0, unvoicedRun = 0;
  const preroll = [];

  function isVoiced(f) {
    return f.f0 > 0 && f.db > gateDb;
  }

  function push(f) {
    if (!active) {
      preroll.push(f);
      if (preroll.length > startFrames + 2) preroll.shift();
      voicedRun = isVoiced(f) ? voicedRun + 1 : 0;
      if (voicedRun >= startFrames) {
        active = true;
        frames = preroll.slice();
        quietRun = unvoicedRun = 0;
      }
      return null;
    }
    frames.push(f);
    quietRun = f.db < gateDb ? quietRun + 1 : 0;
    unvoicedRun = isVoiced(f) ? 0 : unvoicedRun + 1;
    if (quietRun >= silenceFrames || unvoicedRun >= unvoicedFrames || frames.length >= maxFrames) {
      active = false;
      voicedRun = 0;
      preroll.length = 0;
      const out = frames.filter(isVoiced);
      frames = [];
      return out.length ? out : null;
    }
    return null;
  }

  return {
    push,
    get active() { return active; },
    get gateDb() { return gateDb; },
    set gateDb(v) { gateDb = v; },
  };
}

// ---------------------------------------------------------------------------
// Contour extraction
// ---------------------------------------------------------------------------

export const CONTOUR_POINTS = 20;

export const hzToSt = (hz) => 12 * Math.log2(hz / 100);
export const stToHz = (st) => 100 * 2 ** (st / 12);

// frames: voiced frames of one utterance. Returns null if too short to judge.
export function extractContour(frames, { minSec = 0.06, edgeDb = 15 } = {}) {
  if (!frames || frames.length < 4) return null;

  // Keep the loud nucleus of the syllable. Pitch at the weak edges is unreliable:
  // raised after consonants, sagging or creaky as the voice fades. Trimming by
  // loudness instead of a fixed time works the same at any speaking speed.
  const peak = Math.max(...frames.map((f) => f.db));
  const first = frames.findIndex((f) => f.db >= peak - edgeDb);
  const last = frames.length - 1 - [...frames].reverse().findIndex((f) => f.db >= peak - edgeDb);
  frames = frames.slice(first, last + 1);
  if (frames.length < 4 || frames[frames.length - 1].t - frames[0].t < minSec) return null;

  const t = frames.map((f) => f.t);
  let st = frames.map((f) => hzToSt(f.f0));

  // Octave-jump repair against a local median, then outlier cleanup.
  st = st.map((v, i) => {
    const m = median(st.slice(Math.max(0, i - 4), i + 5));
    while (v - m > 8) v -= 12;
    while (m - v > 8) v += 12;
    return v;
  });
  st = st.map((v, i) => {
    const m = median(st.slice(Math.max(0, i - 3), i + 4));
    return Math.abs(v - m) > 3 ? m : v;
  });
  st = st.map((_, i) => median(st.slice(Math.max(0, i - 2), i + 3)));
  st = st.map((_, i) => mean(st.slice(Math.max(0, i - 1), i + 2)));

  // Light extra trim for what the loudness cut leaves of the onset and release.
  const head = Math.min(3, Math.floor(st.length * 0.1));
  const tail = Math.min(2, Math.floor(st.length * 0.08));
  const ts = t.slice(head, t.length - tail);
  const ss = st.slice(head, st.length - tail);

  // Largest internal gap (creak) as a fraction of the duration.
  const duration = ts[ts.length - 1] - ts[0];
  let maxGap = 0;
  for (let i = 1; i < ts.length; i++) maxGap = Math.max(maxGap, ts[i] - ts[i - 1]);

  const grid = resample(ts, ss, CONTOUR_POINTS);
  return {
    st: grid,
    rawT: ts,
    rawSt: ss,
    duration,
    creak: duration > 0 ? Math.max(0, maxGap - 0.02) / duration : 0,
  };
}

function resample(ts, vs, n) {
  const out = new Array(n);
  const t0 = ts[0], t1 = ts[ts.length - 1];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + ((t1 - t0) * i) / (n - 1);
    while (j < ts.length - 2 && ts[j + 1] < t) j++;
    const span = ts[j + 1] - ts[j] || 1;
    const a = Math.min(1, Math.max(0, (t - ts[j]) / span));
    out[i] = vs[j] * (1 - a) + vs[j + 1] * a;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Speaker model: where this person's pitch range sits, in semitones.
// ---------------------------------------------------------------------------

export function createSpeakerModel({ maxSamples = 4000, minSpan = 8 } = {}) {
  let samples = [];
  let pinned = null; // set by explicit calibration

  function add(stValues) {
    samples.push(...stValues);
    if (samples.length > maxSamples) samples = samples.slice(-maxSamples);
  }

  function range() {
    if (pinned && samples.length < 400) return pinned;
    if (samples.length < 60) return pinned;
    const sorted = samples.slice().sort((a, b) => a - b);
    let lo = quantile(sorted, 0.04), hi = quantile(sorted, 0.96);
    if (hi - lo < minSpan) {
      const c = (hi + lo) / 2;
      lo = c - minSpan / 2;
      hi = c + minSpan / 2;
    }
    return { lo, hi };
  }

  // Calibration from free speech (e.g. counting): its median sits roughly mid-range.
  function calibrate(stValues) {
    if (stValues.length < 30) return false;
    const sorted = stValues.slice().sort((a, b) => a - b);
    const mid = quantile(sorted, 0.5);
    const spread = Math.max(minSpan + 2, (quantile(sorted, 0.95) - quantile(sorted, 0.05)) * 1.6);
    pinned = { lo: mid - spread * 0.5, hi: mid + spread * 0.5 };
    return true;
  }

  return {
    add,
    calibrate,
    range,
    reset() { samples = []; pinned = null; },
    get count() { return samples.length; },
    toChao(st) {
      const r = range();
      return r ? 1 + (4 * (st - r.lo)) / (r.hi - r.lo) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Tone classification
// ---------------------------------------------------------------------------

// Shapes are in semitones relative to the start, at a learner-friendly size
// (native speakers move further; the gain fit allows that). `level` is the
// expected mean height on the 1-5 Chao scale.
export const TEMPLATES = {
  T1: { tone: 0, level: 4.4, pts: [[0, 0], [1, -0.3]] },
  T2: { tone: 1, level: 3.4, pts: [[0, 0], [0.25, -0.6], [1, 4.5]] },
  // Fast speech often reaches the top early and levels off as the voice fades.
  T2early: { tone: 1, level: 3.5, pts: [[0, 0], [0.15, -0.4], [0.7, 3.5], [1, 3.7]] },
  T3: { tone: 2, level: 1.9, pts: [[0, 0], [0.5, -4], [0.7, -4], [1, 0]] },
  T3half: { tone: 2, level: 1.6, pts: [[0, 0], [0.55, -3], [1, -3.3]] },
  T4: { tone: 3, level: 3.2, pts: [[0, 0], [0.15, 0.3], [1, -6.5]] },
};

const SIGMA_SHAPE = 0.9; // st of residual we shrug off
const SIGMA_GAIN = 0.9; // log-gain tolerance (learners compress their range)
// Movement a level tone may drift: drift grows with time, deliberate movement doesn't,
// so a short syllable gets less leeway than a long one.
const sigmaFlat = (duration) => 0.8 + 2 * duration;
const SIGMA_LEVEL = 1.1; // Chao units

export function templateCurve(pts, n = CONTOUR_POINTS) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let k = 0;
    while (k < pts.length - 2 && pts[k + 1][0] < x) k++;
    const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
    out[i] = y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
  }
  return out;
}

const centred = (v) => { const m = mean(v); return v.map((x) => x - m); };
const CURVES = Object.fromEntries(
  Object.entries(TEMPLATES).map(([k, v]) => [k, centred(templateCurve(v.pts))])
);

// contour: from extractContour. speaker: from createSpeakerModel (optional).
export function classifyTone(contour, speaker) {
  const c = centred(contour.st);
  const meanSt = mean(contour.st);
  const meanChao = speaker ? speaker.toChao(meanSt) : null;

  const detail = {};
  for (const [name, tpl] of Object.entries(TEMPLATES)) {
    const t = CURVES[name];
    const tt = dot(t, t);
    let gain = 0, dist;
    if (tt < 1) {
      // Level template: penalise total movement (variance underrates a steady ramp).
      const movement = Math.max(...contour.st) - Math.min(...contour.st);
      dist = (movement / sigmaFlat(contour.duration)) ** 2;
    } else {
      gain = clamp(dot(c, t) / tt, 0.2, 2.2);
      const shape = c.reduce((s, v, i) => s + (v - gain * t[i]) ** 2, 0) / c.length;
      dist = shape / SIGMA_SHAPE ** 2 + (Math.log(gain) / SIGMA_GAIN) ** 2;
    }
    if (meanChao != null) dist += ((meanChao - tpl.level) / SIGMA_LEVEL) ** 2;
    if (name.startsWith('T3')) dist -= Math.min(1.5, contour.creak * 6); // creak is a T3 cue
    detail[name] = { dist, gain };
  }

  const d = [
    detail.T1.dist,
    Math.min(detail.T2.dist, detail.T2early.dist),
    Math.min(detail.T3.dist, detail.T3half.dist),
    detail.T4.dist,
  ];
  const lo = Math.min(...d);
  const w = d.map((x) => Math.exp(-0.5 * (x - lo)));
  const sum = w.reduce((a, b) => a + b, 0);
  const probs = w.map((x) => x / sum);
  const best = probs.indexOf(Math.max(...probs));
  return { probs, best, meanChao, detail };
}

// Lenient by default: missing because the detector is unsure feels unfair in a game.
export function judge(result, target, { strict = false } = {}) {
  const p = result.probs[target];
  if (Math.max(...result.probs) < 0.4) return 'unclear';
  if (strict) return result.best === target && p >= 0.6 ? 'pass' : 'fail';
  return result.best === target || p >= 0.35 ? 'pass' : 'fail';
}

// ---------------------------------------------------------------------------

function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function mean(v) { return v.reduce((a, b) => a + b, 0) / v.length; }
function median(v) { const s = v.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function quantile(sorted, q) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]; }
function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
