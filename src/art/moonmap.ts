import * as THREE from 'three';
import { fbm2, hash2, mulberry32 } from '../core/rand';
import { canvasTexture, makeCanvas } from './textures';

/** lon, lat, lonRadius, latRadius, darkness */
const MARIA: [number, number, number, number, number][] = [
  [-52, 20, 24, 19, 0.9], [-46, 36, 12, 10, 0.85], [-17, 34, 17, 13, 0.95], [18, 28, 8.5, 8.5, 0.95],
  [31, 8, 11, 8.5, 0.95], [59, 17, 5.6, 4.6, 0.95], [51, -8, 7.5, 6.5, 0.85], [35, -15, 5.5, 4.8, 0.85],
  [-17, -21, 8, 7, 0.85], [-38, -24, 4.6, 4.2, 0.9], [3, 13, 4.6, 3.6, 0.7], [-30, 7, 7.5, 4.6, 0.8],
  [-23, -10, 4.8, 3.8, 0.8], [34, 30, 2.8, 4.6, 0.8], [0, 56, 28, 3.4, 0.6], [82, 13, 4, 3.6, 0.6],
  [87, -2, 4.6, 3.6, 0.7], [175, 27, 5, 4, 0.8], [-93, -20, 4.2, 4.2, 0.5], [-61, -1, 3.4, 3.4, 0.7],
  [56, 30, 3, 2.6, 0.7], [67, 5, 3.4, 3, 0.6], [26, -28, 5, 4, 0.5],
];

/** Fresh craters with bright ray systems: lon, lat, radius(deg), ray length(deg). */
const RAYS: [number, number, number, number][] = [
  [-11.4, -43.3, 0.85, 11], [20.1, 9.6, 0.92, 7], [38.0, 8.1, 0.5, 6], [47.4, 23.7, 0.4, 4], [46.8, 16.1, 0.45, 3.4], [-63.8, -8.1, 0.5, 4],
];

/** Crater height profile as a function of d = distance / radius: bowl, raised rim, ejecta blanket. */
export function craterProfile(d: number): number {
  if (d >= 1.9) return 0;
  const bowl = d < 0.82 ? -Math.pow(1 - (d / 0.82) ** 2, 0.75) : 0;
  const rim = Math.exp(-(((d - 0.9) / 0.11) ** 2));
  const ejecta = 0.22 * (1 - Math.min(1, Math.max(0, (d - 1) / 0.9)));
  return bowl + rim + ejecta;
}

export interface MoonGlobeMaps {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
}

export function buildMoonGlobe(W = 2048): MoonGlobeMaps {
  const H = W / 2;
  const rnd = mulberry32(1337);
  interface Crater {
    x: number; y: number; r: number; depth: number;
  }
  const craters: Crater[] = [];
  const N = W;
  for (let i = 0; i < N; i++) {
    const r = (0.28 + 2.6 * Math.pow(rnd(), 5)) * (W / 2048);
    const y = Math.asin(1 - 2 * rnd()) * (H / Math.PI); // uniform on the sphere, radians→px
    craters.push({ x: rnd() * W, y: H / 2 - y, r, depth: r * (0.12 + 0.08 * rnd()) });
  }
  for (const [lon, lat, r] of RAYS) craters.push({ x: ((lon + 180) / 360) * W, y: ((90 - lat) / 180) * H, r: r * (W / 360), depth: r * (W / 360) * 0.16 });

  const h = new Float32Array(W * H);
  const a = new Float32Array(W * H);
  for (const c of craters) {
    const R = c.r * 1.9;
    const x0 = Math.floor(c.x - R), x1 = Math.ceil(c.x + R);
    const y0 = Math.max(0, Math.floor(c.y - R)), y1 = Math.min(H - 1, Math.ceil(c.y + R));
    const k = Math.min(1, c.r / 14);
    for (let y = y0; y <= y1; y++) {
      const dy = y - c.y;
      for (let x = x0; x <= x1; x++) {
        const xi = ((x % W) + W) % W;
        const dx = x - c.x;
        const d = Math.hypot(dx, dy) / c.r;
        const p = craterProfile(d);
        const i = y * W + xi;
        h[i] += p * c.depth;
        // large craters: darker floor, brighter rim
        a[i] += (d < 0.8 ? -0.07 : 0) * k + p * 0.09 * k;
      }
    }
  }

  // low-frequency mottling and maria at 1/4 resolution, then upsampled
  const w4 = W / 4, h4 = H / 4;
  const low = new Float32Array(w4 * h4 * 2);
  for (let j = 0; j < h4; j++) {
    const lat = 90 - ((j + 0.5) / h4) * 180;
    for (let i = 0; i < w4; i++) {
      const lon = ((i + 0.5) / w4) * 360 - 180;
      let m = 0;
      for (const [cx, cy, rx, ry, dark] of MARIA) {
        const dx = (lon - cx) / rx, dy = (lat - cy) / ry;
        const v = (1 - Math.min(1, Math.max(0, (dx * dx + dy * dy - 0.25) / 0.9))) * dark;
        const wob = 1 + 0.25 * (fbm2(lon * 0.12 + 40, lat * 0.12, 2) - 0.5);
        if (v * wob > m) m = v * wob;
      }
      const q = (j * w4 + i) * 2;
      low[q] = fbm2(lon * 0.35, lat * 0.35, 4);
      low[q + 1] = Math.min(1, m);
    }
  }
  const sampleLow = (x: number, y: number, ch: number) => {
    const fx = (x / 4) % w4, fy = Math.min(h4 - 1.001, y / 4);
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const g = (i: number, j: number) => low[(j * w4 + ((i % w4) + w4) % w4) * 2 + ch];
    return (g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty;
  };

  const [ac, actx] = makeCanvas(W, H);
  const aimg = actx.createImageData(W, H);
  const [nc, nctx] = makeCanvas(W, H);
  const nimg = nctx.createImageData(W, H);
  // slopes stay within about 30° of vertical: steeper ones shade to black once the map is minified
  const S = 0.5;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = sampleLow(x, y, 0);
      const m = sampleLow(x, y, 1);
      const base = 0.64 + 0.13 * (n - 0.5);
      const dark = 0.37 + 0.10 * (n - 0.5);
      const v = Math.min(1, Math.max(0, (base * (1 - m) + dark * m) / 0.97 + a[i] * 0.6 + h[i] * 0.012));
      const p = i * 4;
      aimg.data[p] = aimg.data[p + 1] = aimg.data[p + 2] = Math.round(Math.pow(v, 2.2) * 255);
      aimg.data[p + 3] = 255;
      const hl = h[y * W + ((x - 1 + W) % W)], hr = h[y * W + ((x + 1) % W)];
      const hu = h[Math.max(0, y - 1) * W + x], hd = h[Math.min(H - 1, y + 1) * W + x];
      const nx = (hl - hr) * S, ny = (hu - hd) * S;
      const len = Math.hypot(nx, ny, 1);
      nimg.data[p] = ((nx / len) * 0.5 + 0.5) * 255;
      nimg.data[p + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nimg.data[p + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[p + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  // ray systems
  const rr = mulberry32(99);
  actx.globalCompositeOperation = 'lighter';
  for (const [lon, lat, r, len] of RAYS) {
    const cx = ((lon + 180) / 360) * W, cy = ((90 - lat) / 180) * H;
    for (let k = 0; k < 110; k++) {
      const ang = rr() * Math.PI * 2;
      const l = (len * (W / 360)) * (0.35 + 0.65 * rr());
      actx.strokeStyle = `rgba(150,150,150,${0.05 + rr() * 0.09})`;
      actx.lineWidth = 1 + rr() * 3;
      actx.beginPath();
      actx.moveTo(cx + Math.cos(ang) * r * (W / 360), cy + Math.sin(ang) * r * (W / 360));
      actx.lineTo(cx + Math.cos(ang + 0.05) * l, cy + Math.sin(ang + 0.05) * l * Math.cos((lat * Math.PI) / 180));
      actx.stroke();
    }
  }
  const albedo = canvasTexture(ac, true);
  albedo.anisotropy = 8;
  const normal = canvasTexture(nc, false);
  normal.anisotropy = 8;
  return { albedo, normal };
}

/** Tileable regolith detail: fine craters + grain. Used on terrain and the orbital backdrop. */
export interface RegolithMaps {
  albedo: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
}

export function buildRegolith(size = 512): RegolithMaps {
  const rnd = mulberry32(4242);
  const h = new Float32Array(size * size);
  // mostly small craters: up close the ground reads as fine dusty regolith, not a field of big rings
  for (let i = 0; i < 720; i++) {
    const r = 0.7 + 9 * Math.pow(rnd(), 3.2);
    const cx = rnd() * size, cy = rnd() * size;
    const depth = r * (0.1 + 0.07 * rnd());
    const R = r * 1.9;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) {
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1.9) h[(((y % size) + size) % size) * size + (((x % size) + size) % size)] += craterProfile(d) * depth;
      }
    }
  }
  const [ac, actx] = makeCanvas(size, size);
  const aimg = actx.createImageData(size, size);
  const [nc, nctx] = makeCanvas(size, size);
  const nimg = nctx.createImageData(size, size);
  const S = 1.3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const g = hash2(x * 7 + 3, y * 7 + 11);
      const grain = (0.8 + 0.36 * g) * (0.9 + 0.2 * hash2(x * 3 + 5, y * 5 + 1));
      const v = Math.min(1, Math.max(0, grain * (1 + h[i] * 0.035)));
      const p = i * 4;
      aimg.data[p] = Math.round(Math.pow(v * 0.96, 2.2) * 255);
      aimg.data[p + 1] = Math.round(Math.pow(v * 0.95, 2.2) * 255);
      aimg.data[p + 2] = Math.round(Math.pow(v * 0.93, 2.2) * 255);
      aimg.data[p + 3] = 255;
      const hl = h[y * size + ((x - 1 + size) % size)], hr = h[y * size + ((x + 1) % size)];
      const hu = h[((y - 1 + size) % size) * size + x], hd = h[((y + 1) % size) * size + x];
      const nx = (hl - hr) * S, ny = (hu - hd) * S;
      const len = Math.hypot(nx, ny, 1);
      nimg.data[p] = ((nx / len) * 0.5 + 0.5) * 255;
      nimg.data[p + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nimg.data[p + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      nimg.data[p + 3] = 255;
    }
  }
  actx.putImageData(aimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  const albedo = canvasTexture(ac, true, true);
  const normal = canvasTexture(nc, false, true);
  albedo.anisotropy = 8;
  normal.anisotropy = 8;
  return { albedo, normal };
}
