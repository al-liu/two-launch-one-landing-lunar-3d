import * as THREE from 'three';
import { fbm2, mulberry32 } from '../core/rand';

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function canvasTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function star(ctx: Ctx, cx: number, cy: number, r: number, aimX: number, aimY: number): void {
  // Five-point star: one outer point aims at (aimX, aimY).
  const base = Math.atan2(aimY - cy, aimX - cx);
  const inner = (r * Math.sin(Math.PI / 10)) / Math.sin((3 * Math.PI) / 10);
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = base + (i * TAU) / 5;
    const b = a + Math.PI / 5;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(b) * inner, cy + Math.sin(b) * inner);
  }
  ctx.closePath();
  ctx.fill();
}
const TAU = Math.PI * 2;

/** 五星红旗, drawn to GB 12982-2004 geometry on a 30×20 grid (ratio 3:2). */
export function flagCanvas(w = 900, h = 600): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const u = w / 30;
  ctx.fillStyle = '#de2910';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ffde00';
  star(ctx, 5 * u, 5 * u, 3 * u, 5 * u, 5 * u - 1);
  star(ctx, 10 * u, 2 * u, 1 * u, 5 * u, 5 * u);
  star(ctx, 12 * u, 4 * u, 1 * u, 5 * u, 5 * u);
  star(ctx, 12 * u, 7 * u, 1 * u, 5 * u, 5 * u);
  star(ctx, 10 * u, 9 * u, 1 * u, 5 * u, 5 * u);
  return c;
}

/** White rocket hull with faint panel seams and rivet noise. */
export function hullCanvas(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(1024, 1024);
  ctx.fillStyle = '#f2f1ec';
  ctx.fillRect(0, 0, 1024, 1024);
  const rnd = mulberry32(7);
  for (let i = 0; i < 9000; i++) {
    const v = 225 + Math.floor(rnd() * 30);
    ctx.fillStyle = `rgba(${v},${v},${v - 4},0.25)`;
    ctx.fillRect(rnd() * 1024, rnd() * 1024, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  ctx.strokeStyle = 'rgba(120,125,135,0.5)';
  ctx.lineWidth = 2;
  for (const y of [70, 300, 560, 820]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(120,125,135,0.28)';
  ctx.lineWidth = 1.5;
  for (let x = 0; x < 1024; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 1024);
    ctx.stroke();
  }
  return c;
}

/** Normal map from a height function, tileable by sampling with wrap. */
export function normalCanvas(size: number, heightFn: (x: number, y: number) => number, strength = 2): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const h = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) h[j * size + i] = heightFn(i / size, j / size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const l = h[j * size + ((i - 1 + size) % size)], r = h[j * size + ((i + 1) % size)];
      const u = h[((j - 1 + size) % size) * size + i], dn = h[((j + 1) % size) * size + i];
      const nx = (l - r) * strength * size * 0.5, ny = (u - dn) * strength * size * 0.5;
      const len = Math.hypot(nx, ny, 1);
      const k = (j * size + i) * 4;
      d[k] = ((nx / len) * 0.5 + 0.5) * 255;
      d[k + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      d[k + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Wrinkled insulation foil. Broad creases only: under a black sky a metal reflects nothing but the sun, so fine crumple turns into black-and-white speckle. */
export function crumpleNormal(strength = 1.2): THREE.CanvasTexture {
  const t = canvasTexture(normalCanvas(512, (x, y) => fbm2(x * 5, y * 5, 2, 2.1, 0.5) + 0.3 * Math.abs(fbm2(x * 2.2 + 3, y * 2.2 + 9, 2) - 0.5), strength), false, true);
  t.repeat.set(2, 2);
  return t;
}

/** Soft radial sprite used for glows and stars. */
export function glowCanvas(size = 128, inner = '#ffffff', power = 2): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const col = new THREE.Color(inner);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot((i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5) * 2;
      const a = Math.pow(Math.max(0, 1 - r), power);
      const k = (j * size + i) * 4;
      d[k] = col.r * 255; d[k + 1] = col.g * 255; d[k + 2] = col.b * 255; d[k + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
