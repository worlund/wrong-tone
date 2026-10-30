import {
  createSegmenter, extractContour, createSpeakerModel, classifyTone, judge,
  hzToSt, templateCurve, TONE_NAMES,
} from './tone-core.js';

const TONE_COLORS = ['#e8c45a', '#5ab0e8', '#b07ae8', '#e8705a'];
const TONE_DESC = ['high level', 'rising', 'dipping', 'falling'];
// Citation contours on the Chao scale, used to draw the target for the learner.
const CHAO_TARGETS = [
  [[0, 5], [1, 5]],
  [[0, 3], [0.25, 2.8], [1, 5]],
  [[0, 2], [0.5, 1], [0.7, 1], [1, 4]],
  [[0, 5], [1, 1]],
];

// Syllables with a common character for every tone.
const SYLLABLES = [
  ['ma', ['妈', 'mā'], ['麻', 'má'], ['马', 'mǎ'], ['骂', 'mà']],
  ['ba', ['八', 'bā'], ['拔', 'bá'], ['把', 'bǎ'], ['爸', 'bà']],
  ['yi', ['一', 'yī'], ['姨', 'yí'], ['椅', 'yǐ'], ['意', 'yì']],
  ['shi', ['诗', 'shī'], ['十', 'shí'], ['使', 'shǐ'], ['是', 'shì']],
  ['tang', ['汤', 'tāng'], ['糖', 'táng'], ['躺', 'tǎng'], ['烫', 'tàng']],
  ['wen', ['温', 'wēn'], ['文', 'wén'], ['稳', 'wěn'], ['问', 'wèn']],
  ['guo', ['锅', 'guō'], ['国', 'guó'], ['果', 'guǒ'], ['过', 'guò']],
  ['xiang', ['香', 'xiāng'], ['详', 'xiáng'], ['想', 'xiǎng'], ['向', 'xiàng']],
  ['fu', ['夫', 'fū'], ['福', 'fú'], ['府', 'fǔ'], ['父', 'fù']],
];

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'tone-lab.attempts.v1';

const state = {
  mode: 'practice',
  running: false,
  node: null,
  ctx: null,
  segmenter: createSegmenter(),
  speaker: createSpeakerModel(),
  live: [], // recent frames for the live view
  prompt: null,
  attempts: loadAttempts(),
  last: null,
  calibrating: null,
  muted: false, // ignore the mic while our own reference voice plays
  advanceTimer: 0,
};

// --- Audio -----------------------------------------------------------------

async function startMic() {
  const btn = $('micBtn');
  if (!window.isSecureContext || !navigator.mediaDevices) {
    const url = `http://localhost:${location.port || 5173}/`;
    setVerdict(`The browser only allows the microphone on https or localhost. Open ${url} instead.`, 'unclear');
    return;
  }
  btn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      // Processing meant for calls distorts pitch, so switch it off.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const ctx = new AudioContext();
    await ctx.resume();
    await ctx.audioWorklet.addModule('pitch-worklet.js');
    const [fmin, fmax] = $('voice').value.split(',').map(Number);
    const node = new AudioWorkletNode(ctx, 'pitch-tracker', { processorOptions: { fmin, fmax } });
    node.port.onmessage = (e) => e.data.forEach(onFrame);
    const sink = ctx.createGain();
    sink.gain.value = 0; // keeps the node pulled by the graph without playing anything
    ctx.createMediaStreamSource(stream).connect(node).connect(sink).connect(ctx.destination);
    Object.assign(state, { ctx, node, running: true });
    btn.textContent = 'Listening…';
    requestAnimationFrame(drawLive);
  } catch (err) {
    btn.disabled = false;
    setVerdict(`Microphone unavailable: ${err.message}`, 'unclear');
  }
}

function onFrame(f) {
  state.live.push(f);
  if (state.live.length > 400) state.live.splice(0, state.live.length - 400);
  $('level').firstElementChild.style.width = `${Math.max(0, Math.min(100, (f.db + 70) * 2))}%`;

  if (state.muted) return;
  if (state.calibrating) {
    if (f.f0 > 0 && f.db > Number($('gate').value)) state.calibrating.push(hzToSt(f.f0));
    return;
  }
  const utterance = state.segmenter.push(f);
  if (utterance) onUtterance(utterance);
}

// --- Utterances ------------------------------------------------------------

function onUtterance(frames) {
  const contour = extractContour(frames);
  if (!contour) {
    // Ignore clicks, but tell the player when a real (very short) syllable was dropped.
    if (frames[frames.length - 1].t - frames[0].t > 0.04) setVerdict('Too short: let the vowel ring a little', 'unclear');
    return;
  }
  if (contour.duration > 1.6) {
    setVerdict('Too long: say a single syllable', 'unclear');
    return;
  }
  state.speaker.add(contour.rawSt);
  const known = !!state.speaker.range();
  const result = classifyTone(contour, known ? state.speaker : null);
  state.last = { contour, result };

  if (state.mode === 'practice' && state.prompt) {
    const target = state.prompt.tone;
    const verdict = judge(result, target, { strict: $('strict').checked });
    recordAttempt({ contour, result, target, verdict });
    const said = TONE_NAMES[result.best];
    if (verdict === 'pass') setVerdict(`✓ ${said}`, 'pass');
    else if (verdict === 'fail') setVerdict(`✗ Heard ${said}, wanted ${TONE_NAMES[target]}`, 'fail');
    else setVerdict('? Unclear, try again', 'unclear');
    if (verdict === 'pass' && $('autoNext').checked) {
      clearTimeout(state.advanceTimer);
      state.advanceTimer = setTimeout(nextPrompt, 1200);
    }
  } else if (state.mode === 'free') {
    const p = result.probs[result.best];
    $('freeResult').textContent = TONE_NAMES[result.best];
    $('freeResult').style.color = TONE_COLORS[result.best];
    setVerdict(`${TONE_DESC[result.best]} · ${(p * 100).toFixed(0)}%`, p >= 0.4 ? 'pass' : 'unclear');
  }

  drawContour();
  renderProbs(result);
  renderRange();
  $('meta').textContent =
    `${(contour.duration * 1000).toFixed(0)} ms · creak ${(contour.creak * 100).toFixed(0)}% · ` +
    (result.meanChao != null ? `mean height ${result.meanChao.toFixed(1)} / 5` : 'pitch range not known yet');
}

// --- Practice prompts ------------------------------------------------------

function nextPrompt() {
  clearTimeout(state.advanceTimer);
  // Weight towards tones you miss most, so practice targets weak spots.
  const misses = [0, 1, 2, 3].map((t) =>
    1 + state.attempts.filter((a) => a.target === t && a.verdict !== 'pass').length * 0.5);
  let r = Math.random() * misses.reduce((a, b) => a + b, 0);
  let tone = 0;
  while ((r -= misses[tone]) > 0 && tone < 3) tone++;
  const syl = SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
  const [hanzi, pinyin] = syl[tone + 1];
  state.prompt = { syllable: syl[0], hanzi, pinyin, tone };
  $('hanzi').textContent = hanzi;
  $('pinyin').textContent = pinyin;
  $('toneLabel').textContent = `Tone ${tone + 1} · ${TONE_DESC[tone]}`;
  $('toneLabel').style.color = TONE_COLORS[tone];
  setVerdict('', '');
}

function speak() {
  if (!state.prompt || !window.speechSynthesis) return;
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => /^zh[-_]CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang));
  if (!voice) {
    setVerdict('No Chinese text-to-speech voice installed', 'unclear');
    return;
  }
  const u = new SpeechSynthesisUtterance(state.prompt.hanzi);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.8;
  // Our own mic would hear the speakers; ignore it while the voice plays.
  state.muted = true;
  u.onend = u.onerror = () => setTimeout(() => (state.muted = false), 250);
  speechSynthesis.speak(u);
}

// --- Calibration -----------------------------------------------------------

function calibrate() {
  if (!state.running) return setVerdict('Start the microphone first', 'unclear');
  state.calibrating = [];
  $('calBtn').disabled = true;
  let left = 6;
  $('calStatus').textContent = `Recording… ${left}`;
  const timer = setInterval(() => {
    left--;
    $('calStatus').textContent = `Recording… ${left}`;
    if (left > 0) return;
    clearInterval(timer);
    const ok = state.speaker.calibrate(state.calibrating);
    state.calibrating = null;
    $('calBtn').disabled = false;
    $('calStatus').textContent = ok
      ? 'Calibrated. You can still refine it with practice attempts.'
      : 'Not enough voice detected. Try speaking louder or lowering the noise gate.';
    renderRange();
  }, 1000);
}

// --- Attempts and stats ----------------------------------------------------

function loadAttempts() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function saveAttempts() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.attempts)); } catch { /* storage unavailable */ }
}

function recordAttempt({ contour, result, target, verdict }) {
  const r = state.speaker.range();
  state.attempts.push({
    at: new Date().toISOString(),
    syllable: state.prompt.syllable,
    hanzi: state.prompt.hanzi,
    target,
    predicted: result.best,
    probs: result.probs.map((p) => +p.toFixed(3)),
    verdict,
    disputed: false,
    meanChao: result.meanChao,
    range: r && { lo: +r.lo.toFixed(2), hi: +r.hi.toFixed(2) },
    duration: +contour.duration.toFixed(3),
    creak: +contour.creak.toFixed(3),
    contourSt: contour.st.map((v) => +v.toFixed(2)),
    rawT: contour.rawT.map((v) => +(v - contour.rawT[0]).toFixed(3)),
    rawSt: contour.rawSt.map((v) => +v.toFixed(2)),
    settings: { gate: +$('gate').value, voice: $('voice').value, strict: $('strict').checked },
  });
  saveAttempts();
  renderMatrix();
}

function renderMatrix() {
  const m = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  let pass = 0;
  for (const a of state.attempts) {
    m[a.target][a.predicted]++;
    if (a.verdict === 'pass') pass++;
  }
  const n = state.attempts.length;
  $('acc').textContent = n ? `${n} attempts · ${Math.round((100 * pass) / n)}% passed` : '';
  $('matrix').innerHTML =
    `<tr><th>said \\ heard</th>${TONE_NAMES.map((t) => `<th>${t}</th>`).join('')}</tr>` +
    m.map((row, i) => `<tr><th>${TONE_NAMES[i]}</th>${row
      .map((v, j) => `<td class="${i === j && v ? 'diag' : ''}">${v || ''}</td>`).join('')}</tr>`).join('');
}

function exportAttempts() {
  const blob = new Blob([JSON.stringify({ version: 1, attempts: state.attempts }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tone-lab-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- Rendering -------------------------------------------------------------

function setVerdict(text, cls) {
  const el = $('verdict');
  el.textContent = text;
  el.className = `verdict ${cls}`;
}

function renderProbs(result) {
  $('probs').innerHTML = result.probs.map((p, i) => `
    <div class="prob ${i === result.best ? 'best' : ''}">${TONE_NAMES[i]} ${(p * 100).toFixed(0)}%
      <div class="bar"><i style="width:${p * 100}%;background:${TONE_COLORS[i]}"></i></div>
    </div>`).join('');
}

function renderRange() {
  const r = state.speaker.range();
  $('range').textContent = r
    ? `Your pitch range: ${Math.round(100 * 2 ** (r.lo / 12))}–${Math.round(100 * 2 ** (r.hi / 12))} Hz (${(r.hi - r.lo).toFixed(1)} semitones)`
    : 'Pitch range: still learning. Calibrate, or do a few practice attempts across all four tones.';
}

function fitCanvas(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function drawContour() {
  const { g, w, h } = fitCanvas($('contour'));
  if (!state.last) return;
  const { contour } = state.last;
  const r = state.speaker.range();
  const pad = 24;

  // Vertical scale: the speaker's range when known, otherwise the utterance itself.
  let lo, hi;
  if (r) { lo = r.lo - 1.5; hi = r.hi + 1.5; }
  else { lo = Math.min(...contour.rawSt) - 3; hi = Math.max(...contour.rawSt) + 3; }
  const y = (st) => h - pad - ((st - lo) / (hi - lo)) * (h - 2 * pad);
  const x = (u) => pad + u * (w - 2 * pad);

  g.font = '11px system-ui';
  if (r) {
    for (let c = 1; c <= 5; c++) {
      const st = r.lo + ((c - 1) / 4) * (r.hi - r.lo);
      g.strokeStyle = '#26262c';
      g.beginPath(); g.moveTo(pad, y(st)); g.lineTo(w - pad, y(st)); g.stroke();
      g.fillStyle = '#5c5a57';
      g.fillText(String(c), 6, y(st) + 4);
    }
  }

  // Target shape for the current prompt.
  const target = state.mode === 'practice' && state.prompt ? state.prompt.tone : null;
  if (target != null) {
    const chao = templateCurve(CHAO_TARGETS[target], 50);
    const toSt = r
      ? (c) => r.lo + ((c - 1) / 4) * (r.hi - r.lo)
      : (c) => contour.rawSt.reduce((a, b) => a + b, 0) / contour.rawSt.length + (c - 3) * 2;
    g.strokeStyle = TONE_COLORS[target] + '55';
    g.lineWidth = 10;
    g.lineCap = 'round';
    g.beginPath();
    chao.forEach((c, i) => (i ? g.lineTo : g.moveTo).call(g, x(i / 49), y(toSt(c))));
    g.stroke();
  }

  // Raw pitch points, then the cleaned contour.
  const t0 = contour.rawT[0], t1 = contour.rawT[contour.rawT.length - 1];
  g.fillStyle = '#8d8a85';
  contour.rawT.forEach((t, i) => {
    g.beginPath();
    g.arc(x((t - t0) / (t1 - t0 || 1)), y(contour.rawSt[i]), 2, 0, Math.PI * 2);
    g.fill();
  });
  const best = state.last.result.best;
  g.strokeStyle = TONE_COLORS[best];
  g.lineWidth = 3;
  g.beginPath();
  contour.st.forEach((st, i) => (i ? g.lineTo : g.moveTo).call(g, x(i / (contour.st.length - 1)), y(st)));
  g.stroke();
}

function drawLive() {
  const { g, w, h } = fitCanvas($('live'));
  const now = state.live.length ? state.live[state.live.length - 1].t : 0;
  const span = 3;
  const [fmin, fmax] = $('voice').value.split(',').map(Number);
  const lo = hzToSt(fmin), hi = hzToSt(fmax);
  const gate = Number($('gate').value);
  g.fillStyle = state.segmenter.active ? '#d6402f' : '#3fae7a';
  for (const f of state.live) {
    if (!(f.f0 > 0) || f.db < gate || now - f.t > span) continue;
    const px = w - ((now - f.t) / span) * w;
    const py = h - ((hzToSt(f.f0) - lo) / (hi - lo)) * h;
    g.fillRect(px - 1.5, py - 1.5, 3, 3);
  }
  if (state.running) requestAnimationFrame(drawLive);
}

// --- Wiring ----------------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  document.querySelectorAll('.mode').forEach((el) => (el.hidden = !el.classList.contains(`mode-${mode}`)));
  setVerdict('', '');
}

$('micBtn').onclick = startMic;
$('nextBtn').onclick = nextPrompt;
$('hearBtn').onclick = speak;
$('calBtn').onclick = calibrate;
$('exportBtn').onclick = exportAttempts;
$('clearBtn').onclick = () => {
  if (!confirm('Delete all recorded attempts?')) return;
  state.attempts = [];
  saveAttempts();
  renderMatrix();
};
$('disputeBtn').onclick = () => {
  const a = state.attempts[state.attempts.length - 1];
  if (!a) return;
  a.disputed = true;
  saveAttempts();
  setVerdict('Flagged for tuning. Thanks!', 'unclear');
};
$('gate').oninput = (e) => {
  state.segmenter.gateDb = Number(e.target.value);
  $('gateOut').textContent = `${e.target.value} dB`;
};
$('voice').onchange = (e) => {
  const [fmin, fmax] = e.target.value.split(',').map(Number);
  state.node?.port.postMessage({ fmin, fmax });
};
document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
window.addEventListener('resize', drawContour);
document.addEventListener('visibilitychange', () => {
  if (!state.ctx) return;
  document.hidden ? state.ctx.suspend() : state.ctx.resume();
});
window.speechSynthesis?.getVoices(); // voices load lazily in Chrome

nextPrompt();
renderMatrix();
renderRange();
