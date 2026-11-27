import * as THREE from 'three';
import { hash2 } from '../core/rand';
import { canvasTexture, makeCanvas } from './textures';
import type { Ctx } from './textures';
import { CITIES, DESERTS, LAKES, LAND } from './coastlines';

export interface EarthMaps {
  /** Equirectangular data map: R = land mask, G = aridity, B = ice. Linear filtering, no colour space. */
  map: THREE.CanvasTexture;
  /** Tileable noise: R = terrain detail, G = cloud detail, B = large-scale variation. */
  noise: THREE.CanvasTexture;
  /** City lights on the night side (white on transparent). */
  night: THREE.CanvasTexture;
}

const W = 2048;
const H = 1024;

function poly(ctx: Ctx, pts: string): void {
  const v = pts.trim().split(/\s+/).map(Number);
  ctx.beginPath();
  for (let i = 0; i < v.length; i += 2) {
    const x = ((v[i] + 180) / 360) * W;
    const y = ((90 - v[i + 1]) / 180) * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Lattice value noise that tiles every `period` cells. */
function tnoise(x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (a: number) => ((a % period) + period) % period;
  const h = (a: number, b: number) => hash2(w(a) + period * 977, w(b) + period * 131);
  const n00 = h(xi, yi), n10 = h(xi + 1, yi), n01 = h(xi, yi + 1), n11 = h(xi + 1, yi + 1);
  return (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
}

function tfbm(u: number, v: number, period: number, octaves: number, gain = 0.5): number {
  let sum = 0, amp = 0.5, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += tnoise(u * p, v * p, p) * amp;
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

export function buildEarthMaps(): EarthMaps {
  // ---- land and ice masks ------------------------------------------------------
  const [lm, lc] = makeCanvas(W, H);
  lc.fillStyle = '#f00';
  for (const l of LAND) poly(lc, l.pts);
  lc.globalCompositeOperation = 'destination-out';
  for (const l of LAKES) poly(lc, l.pts);
  const land = lc.getImageData(0, 0, W, H).data;

  const [, ic] = makeCanvas(W, H);
  ic.fillStyle = '#fff';
  for (const l of LAND) if (l.ice) poly(ic, l.pts);
  const ice = ic.getImageData(0, 0, W, H).data;

  // ---- packed data map --------------------------------------------------------------
  const [dm, dc] = makeCanvas(W, H);
  const out = dc.createImageData(W, H);
  const o = out.data;
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) / H) * 180;
    const polar = smooth(70, 78, Math.abs(lat));
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W) * 360 - 180;
      const k = j * W + i;
      const isLand = land[k * 4 + 3] / 255;
      let arid = 0;
      for (let d = 0; d < DESERTS.length; d++) {
        const e = DESERTS[d];
        const dx = (lon - e[0]) / e[2];
        const dy = (lat - e[1]) / e[3];
        const a = 1 - smooth(0.4, 1.0, dx * dx + dy * dy);
        if (a > arid) arid = a;
      }
      const p = k * 4;
      o[p] = isLand * 255;
      o[p + 1] = arid * 255;
      o[p + 2] = Math.max(ice[k * 4] / 255, polar) * 255;
      o[p + 3] = 255;
    }
  }
  dc.putImageData(out, 0, 0);
  const map = canvasTexture(dm, false);
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = 8;

  // ---- tileable noise -----------------------------------------------------------------
  const N = 512;
  const [nc, nctx] = makeCanvas(N, N);
  const nimg = nctx.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = i / N, v = j / N;
      const terrain = tfbm(u, v, 6, 5);
      const c = tfbm(u + 0.31, v + 0.17, 3, 5, 0.55);
      const cloud = Math.min(1, Math.max(0, (c - 0.32) * 2.4));
      const p = (j * N + i) * 4;
      nimg.data[p] = terrain * 255;
      nimg.data[p + 1] = cloud * 255;
      nimg.data[p + 2] = tfbm(u + 0.7, v + 0.5, 24, 3) * 255;
      nimg.data[p + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const noise = canvasTexture(nc, false, true);

  // ---- night lights: city clusters, speckled with grain, clipped to land -----------------
  const [gc, gctx] = makeCanvas(N, N);
  const gimg = gctx.createImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const p = i * 4;
    const v = nimg.data[p + 2];
    gimg.data[p] = gimg.data[p + 1] = gimg.data[p + 2] = 255;
    gimg.data[p + 3] = Math.min(255, Math.max(0, (v - 70) * 2.6));
  }
  gctx.putImageData(gimg, 0, 0);
  const [lc2, xctx] = makeCanvas(W / 2, H / 2);
  for (const [lon, lat, w] of CITIES) {
    const x = ((lon + 180) / 360) * (W / 2);
    const y = ((90 - lat) / 180) * (H / 2);
    const r = 4 + 12 * w;
    const g = xctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    xctx.fillStyle = g;
    xctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  xctx.globalCompositeOperation = 'destination-in';
  const grain = xctx.createPattern(gc, 'repeat');
  if (grain) xctx.fillStyle = grain;
  xctx.fillRect(0, 0, W / 2, H / 2);
  xctx.drawImage(lm, 0, 0, W / 2, H / 2);
  const night = canvasTexture(lc2, false);
  night.wrapS = THREE.RepeatWrapping;
  return { map, noise, night };
}
