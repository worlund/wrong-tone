// Procedural Backrooms textures drawn on canvases: no image downloads in v1.
// Seeded, so the room looks identical on every load and for every player.

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three/webgpu';

function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(size: number, draw: (g: CanvasRenderingContext2D, rand: () => number) => void, seed: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  draw(g, rng(seed));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function speckle(g: CanvasRenderingContext2D, rand: () => number, size: number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const v = rand() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${alpha * rand()})`;
    g.fillRect(rand() * size, rand() * size, 1 + rand() * 2, 1 + rand() * 2);
  }
}

/** Mono-yellow wallpaper with faint vertical stripes and a small repeating motif. One tile = 1 m. */
export function wallpaper(): CanvasTexture {
  return canvasTexture(256, (g, rand) => {
    g.fillStyle = '#c7b35c';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = 'rgba(120,100,30,0.07)';
      g.fillRect(x, 0, 14, 256);
    }
    g.strokeStyle = 'rgba(110,90,25,0.12)';
    g.lineWidth = 2;
    for (let y = 16; y < 256; y += 32) {
      for (let x = 16; x < 256; x += 32) {
        g.beginPath();
        g.moveTo(x - 5, y + 3);
        g.lineTo(x, y - 3);
        g.lineTo(x + 5, y + 3);
        g.stroke();
      }
    }
    speckle(g, rand, 256, 2500, 0.08);
  }, 11);
}

/** Damp brownish carpet: noisy fibres with darker blotches. One tile = 1 m. */
export function carpet(): CanvasTexture {
  return canvasTexture(256, (g, rand) => {
    g.fillStyle = '#7d6c3f';
    g.fillRect(0, 0, 256, 256);
    const img = g.getImageData(0, 0, 256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 34;
      img.data[i] = img.data[i]! + n;
      img.data[i + 1] = img.data[i + 1]! + n;
      img.data[i + 2] = img.data[i + 2]! + n * 0.6;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 6; i++) {
      const x = rand() * 256, y = rand() * 256, r = 20 + rand() * 50;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(40,30,10,0.22)');
      grad.addColorStop(1, 'rgba(40,30,10,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }, 23);
}

/** Drop-ceiling tiles: off-white with a darker grid. One tile = 1.2 m. */
export function ceilingTiles(): CanvasTexture {
  return canvasTexture(128, (g, rand) => {
    g.fillStyle = '#b4ad97'; // darker than the tubes, so lit panels read as the brightest thing
    g.fillRect(0, 0, 128, 128);
    speckle(g, rand, 128, 900, 0.12);
    g.fillStyle = '#8f8a78';
    g.fillRect(0, 0, 128, 3);
    g.fillRect(0, 0, 3, 128);
  }, 37);
}
