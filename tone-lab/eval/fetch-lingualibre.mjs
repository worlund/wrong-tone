// Downloads native Mandarin single-character recordings from Lingua Libre (Wikimedia Commons)
// and labels each with its tone. Characters with more than one reading are skipped.
// Recordings are CC BY-SA (see each file's Commons page); attribution is kept in manifest.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import { polyphonic } from 'pinyin-pro';

const OUT = path.resolve('data/lingualibre');
const API = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'WrongTone-ToneLab/0.1 (tone detection research; local evaluation)' };
const CJK = /^[一-鿿]$/;

async function api(params) {
  const url = `${API}?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error(`API failed: ${url}`);
}

// Paced downloads with backoff: Commons answers bursts with 429.
async function download(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 && res.status < 500) return null;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 5000 * 2 ** attempt;
    console.log(`rate limited, waiting ${Math.round(wait / 1000)} s`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return null;
}

// 1. List all Lingua Libre Mandarin files.
const titles = [];
let offset = 0;
while (true) {
  const data = await api({
    action: 'query', list: 'search', srsearch: 'intitle:"LL-Q9192 (cmn)"',
    srnamespace: '6', srlimit: '500', sroffset: String(offset),
  });
  titles.push(...data.query.search.map((s) => s.title));
  if (!data.continue) break;
  offset = data.continue.sroffset;
}
console.log(`${titles.length} Mandarin recordings listed`);

// 2. Keep single characters with exactly one reading and a full tone (1-4).
const items = [];
for (const title of titles) {
  const m = title.match(/^File:LL-Q9192 \(cmn\)-(.+)-(.+)\.(wav|ogg|oga|flac|mp3)$/);
  if (!m || !CJK.test(m[2])) continue;
  const readings = polyphonic(m[2], { toneType: 'num' })[0].split(' ');
  if (readings.length !== 1) continue;
  const tone = Number(readings[0].slice(-1));
  if (!(tone >= 1 && tone <= 4)) continue;
  items.push({ title, speaker: m[1], char: m[2], pinyin: readings[0], tone });
}
console.log(`${items.length} unambiguous single-character recordings`);

// 3. Resolve download URLs (50 per request) and download.
await fs.mkdir(OUT, { recursive: true });
const manifest = [];
for (let i = 0; i < items.length; i += 50) {
  const batch = items.slice(i, i + 50);
  const data = await api({
    action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', titles: batch.map((b) => b.title).join('|'),
  });
  const byTitle = Object.fromEntries(Object.values(data.query.pages).map((p) => [p.title, p]));
  for (const item of batch) {
    const info = byTitle[item.title]?.imageinfo?.[0];
    if (!info) continue;
    // Download URLs carry tracking query parameters; take the extension from the path only.
    const ext = path.extname(new URL(info.url).pathname);
    const file = `${item.speaker.replace(/[^\w-]+/g, '_')}-${item.char}${ext}`;
    const dest = path.join(OUT, file);
    try {
      await fs.access(dest);
    } catch {
      const buf = await download(info.url);
      if (!buf) { console.warn(`\nskip ${item.title}`); continue; }
      await fs.writeFile(dest, buf);
    }
    manifest.push({
      ...item, file,
      source: info.descriptionurl,
      license: info.extmetadata?.LicenseShortName?.value,
    });
  }
  // Save as we go, so an interrupted run is still usable and resumes where it stopped.
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`${manifest.length}/${items.length} downloaded`);
}
const speakers = {};
for (const m of manifest) speakers[m.speaker] = (speakers[m.speaker] || 0) + 1;
console.log(`\nSpeakers:`, speakers);
console.log('Tones:', [1, 2, 3, 4].map((t) => `T${t}=${manifest.filter((m) => m.tone === t).length}`).join(' '));
