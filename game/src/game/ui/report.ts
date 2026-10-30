// Step 8: the incident report. Every word event of the shift with its outcome and inferred
// grade; for spoken answers, the player's pitch curve over the target tone's shape.

import type { Run } from '../run';
import type { WordLog } from '../language/wordLog';
import type { WordEvent } from '../events';

// Citation contours on the 1–5 Chao scale, for drawing the target shape.
const TARGET_SHAPES: Record<number, [number, number][]> = {
  1: [[0, 5], [1, 5]],
  2: [[0, 3], [0.25, 2.8], [1, 5]],
  3: [[0, 2], [0.5, 1], [0.7, 1], [1, 4]],
  4: [[0, 5], [1, 1]],
};
const FACET_LABEL: Record<string, string> = { read: 'Read', speak: 'Said', listen: 'Heard', write: 'Wrote', silence: 'Silence' };
const GRADE_LABEL: Record<string, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

export function showReport(root: HTMLElement, words: WordLog, run: Run, onPlayAgain: () => void): () => void {
  const el = document.createElement('div');
  el.className = 'report';
  const rows = words.events.map((e, i) => `
    <tr class="${e.correct ? 'ok' : 'bad'}">
      <td class="word"><span class="hanzi">${e.hanzi}</span> <span class="pinyin">${e.pinyin}</span><div class="meaning">${e.meaning}</div></td>
      <td>${FACET_LABEL[e.facet] ?? e.facet}</td>
      <td>${outcome(e)}</td>
      <td>${e.responseTime.toFixed(1)} s</td>
      <td>${e.first ? GRADE_LABEL[e.grade] : '<span class="muted">practice</span>'}</td>
      <td>${e.speech && e.speech.contour.length ? `<canvas data-i="${i}" width="160" height="56"></canvas>` : ''}</td>
    </tr>`).join('');
  el.innerHTML = `
    <h1>Shift complete</h1>
    <p class="stats">${run.wrongDoors} wrong door${run.wrongDoors === 1 ? '' : 's'} · ${run.wrongTones} wrong tone${run.wrongTones === 1 ? '' : 's'} · caught ${run.caught} time${run.caught === 1 ? '' : 's'}</p>
    <table><thead><tr><th>Word</th><th>Skill</th><th>Outcome</th><th>Time</th><th>Grade</th><th>Your pitch</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Only the first time you meet a word counts as its grade; repeats are practice. The dashed line is the target tone’s shape.</p>
    <button class="again">Play again</button>`;
  root.append(el);
  el.querySelectorAll<HTMLCanvasElement>('canvas[data-i]').forEach((c) => drawContour(c, words.events[Number(c.dataset.i)]!));
  el.querySelector('.again')!.addEventListener('click', () => {
    el.remove();
    onPlayAgain();
  });
  return () => el.remove();
}

function outcome(e: WordEvent): string {
  if (e.facet === 'speak' && e.speech) {
    return e.correct ? `Tone ${e.speech.heard} ✓` : `Heard tone ${e.speech.heard}, wanted ${e.speech.target}`;
  }
  if (e.facet === 'silence') return e.correct ? 'Stayed quiet' : 'It heard you';
  return e.correct ? 'Correct' : 'Wrong';
}

function drawContour(canvas: HTMLCanvasElement, e: WordEvent): void {
  const g = canvas.getContext('2d')!;
  const st = e.speech!.contour;
  const { width: w, height: h } = canvas;
  const pad = 6;
  const lo = Math.min(...st), hi = Math.max(...st);
  const span = Math.max(hi - lo, 6); // a flat line still looks flat, not noise blown up
  const mid = (lo + hi) / 2;
  const y = (v: number) => h - pad - ((v - (mid - span / 2)) / span) * (h - 2 * pad);
  const x = (u: number) => pad + u * (w - 2 * pad);

  // Target shape, stretched over the same span.
  const shape = TARGET_SHAPES[e.speech!.target]!;
  g.setLineDash([4, 4]);
  g.strokeStyle = 'rgba(232, 217, 138, 0.6)';
  g.lineWidth = 2;
  g.beginPath();
  shape.forEach(([u, chao], i) => {
    const v = mid - span / 2 + ((chao - 1) / 4) * span;
    (i ? g.lineTo : g.moveTo).call(g, x(u), y(v));
  });
  g.stroke();

  g.setLineDash([]);
  g.strokeStyle = e.correct ? '#7fd49b' : '#e0705a';
  g.lineWidth = 2.5;
  g.beginPath();
  st.forEach((v, i) => (i ? g.lineTo : g.moveTo).call(g, x(i / (st.length - 1)), y(v)));
  g.stroke();
}
