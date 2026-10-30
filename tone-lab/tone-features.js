// Feature vector for the learned tone classifier. Shared by training (eval/fit.mjs)
// and inference (tone-core.js), so both always compute features the same way.

const SHAPE_POINTS = 10;

export const FEATURE_NAMES = [
  ...Array.from({ length: SHAPE_POINTS }, (_, i) => `shape${i}`),
  'movement', 'riseLate', 'dipDepth', 'minPos',
  'height', 'heightKnown', 'duration', 'creak',
];

// c: { st: number[] (semitones), duration, creak, meanChao (null if range unknown) }
export function toneFeatures(c) {
  const st = c.st;
  const n = st.length;
  const mean = st.reduce((a, b) => a + b, 0) / n;
  // Pitch shape relative to its own mean, at 10 points.
  const shape = Array.from({ length: SHAPE_POINTS }, (_, i) => {
    const x = (i * (n - 1)) / (SHAPE_POINTS - 1);
    const j = Math.min(n - 2, Math.floor(x));
    const a = x - j;
    return st[j] * (1 - a) + st[j + 1] * a - mean;
  });
  let min = Infinity, minAt = 0, max = -Infinity;
  st.forEach((v, i) => { if (v < min) { min = v; minAt = i; } if (v > max) max = v; });
  const third = Math.floor(n / 3);
  const avg = (a, b) => st.slice(a, b).reduce((s, v) => s + v, 0) / (b - a);
  return [
    ...shape,
    max - min,
    avg(n - third, n) - avg(third, n - third), // does it climb at the end
    Math.min(st[0], st[n - 1]) - min, // how far the middle dips below both ends
    minAt / (n - 1),
    c.meanChao ?? 3,
    c.meanChao == null ? 0 : 1,
    c.duration,
    c.creak,
  ];
}
