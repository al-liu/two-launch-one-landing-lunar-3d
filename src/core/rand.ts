/** Deterministic pseudo-random helpers. Everything animated derives from these, never from Math.random(). */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash1(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function hash2(x: number, y: number): number {
  return hash1(Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263));
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = fade(x - xi);
  const fy = fade(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y) * amp;
    norm += amp;
    x = x * lacunarity + 17.3;
    y = y * lacunarity + 9.1;
    amp *= gain;
  }
  return sum / norm;
}

/** Sample a precomputed random table with a per-instance index (stable across frames). */
export class RandTable {
  readonly data: Float32Array;
  constructor(seed: number, count: number, stride = 4) {
    const rnd = mulberry32(seed);
    this.data = new Float32Array(count * stride);
    for (let i = 0; i < this.data.length; i++) this.data[i] = rnd();
  }
}
