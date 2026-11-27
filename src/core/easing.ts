export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Normalized progress of x inside [a, b]. */
export const seg = (x: number, a: number, b: number) => clamp((x - a) / (b - a));

export const smoothstep = (a: number, b: number, x: number) => {
  const t = seg(x, a, b);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a: number, b: number, x: number) => {
  const t = seg(x, a, b);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const easeInQuad = (t: number) => t * t;
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInCubic = (t: number) => t * t * t;
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
export const easeInQuart = (t: number) => t * t * t * t;
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeOutBack = (t: number, s = 1.4) => {
  const c = s + 1;
  return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};

/** 0 before a, 1 between a and b, 0 after c, with smooth edges (a<b<c). */
export const window01 = (x: number, a: number, b: number, c: number) => smoothstep(a, b, x) * (1 - smoothstep(b, c, x));

/** 1 in [a, b] with soft fade-in of length f and fade-out of length g. */
export const plateau = (x: number, a: number, b: number, fin = 0.5, fout = 0.5) =>
  smoothstep(a - fin, a, x) * (1 - smoothstep(b, b + fout, x));

/** Slow-motion curve: compresses real time around [a, b]. Returns remapped progress. */
export const bell = (x: number, center: number, halfWidth: number) => {
  const d = Math.abs(x - center) / halfWidth;
  return d >= 1 ? 0 : 1 - d * d * (3 - 2 * d);
};

export const wrap = (x: number, m: number) => ((x % m) + m) % m;

/** Deterministic damped oscillation, 0 for x <= 0. */
export const shake = (x: number, freq: number, decay: number) =>
  x <= 0 ? 0 : Math.sin(x * freq) * Math.exp(-x * decay);
