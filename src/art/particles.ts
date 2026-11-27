import * as THREE from 'three';
import { mulberry32 } from '../core/rand';

/**
 * Stateless billboard particles. Every particle's position is a closed-form function of
 * (event time, seed), so scrubbing backwards replays the effect exactly.
 */
export interface ParticlesOpts {
  count: number;
  seed?: number;
  additive?: boolean;
  /** fn(i, rnd) → spawn offset and velocity in the emitter's local space. */
  spawn: (i: number, rnd: () => number, out: { offset: THREE.Vector3; vel: THREE.Vector3 }) => void;
}

export interface EmitParams {
  time: number;
  life: number;
  size0: number;
  size1: number;
  drag?: number;
  accel?: THREE.Vector3;
  wobble?: [number, number];
  fadeIn?: number;
  fadePow?: number;
  stretch?: number;
  soft?: number;
  noise?: number;
  opacity?: number;
  intensity?: number;
  flicker?: number;
  /** Emit a single burst instead of looping forever. */
  once?: boolean;
  colorA?: THREE.Color;
  colorB?: THREE.Color;
}

const VERT = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aVel;
attribute vec4 aSeed;
uniform float uTime, uLife, uDrag, uStretch, uOnce;
uniform vec2 uSize;
uniform vec3 uAccel;
uniform vec2 uWobble;
varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying float vAlive;

void main() {
  float raw = uTime - aSeed.x * uLife;
  float cyc = floor(raw / uLife);
  float age = raw - cyc * uLife;
  // clamp: a hair over 1.0 from float rounding would make pow(1.0 - an, k) produce NaN
  float an = clamp(age / uLife, 0.0, 1.0);
  float dist = uDrag > 1e-4 ? (1.0 - exp(-age * uDrag)) / uDrag : age;
  vec3 p = aOffset + aVel * dist + 0.5 * uAccel * age * age;
  float ph = aSeed.y * 6.2831;
  p += uWobble.x * vec3(sin(age * uWobble.y + ph), cos(age * uWobble.y * 0.83 + ph * 1.7), sin(age * uWobble.y * 0.61 + ph * 2.3));

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 sideV = vec3(1.0, 0.0, 0.0);
  vec3 upV = vec3(0.0, 1.0, 0.0);
  if (uStretch > 0.0) {
    vec3 velView = (viewMatrix * vec4(aVel * exp(-age * uDrag) + uAccel * age, 0.0)).xyz;
    upV = normalize(velView + vec3(0.0, 0.0, 1e-5));
    sideV = normalize(cross(upV, normalize(-mv.xyz)));
  }
  float size = uSize.x + uSize.y * an;
  mv.xyz += sideV * position.x * size + upV * position.y * size * (1.0 + uStretch);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vAge = an;
  vSeed = aSeed.z;
  vAlive = (raw >= 0.0 && (uOnce < 0.5 || raw < uLife)) ? 1.0 : 0.0;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorA, uColorB;
uniform float uSoft, uNoise, uOpacity, uIntensity, uFlicker, uTime, uFadeIn, uFadePow;
varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying float vAlive;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  float disc = 1.0 - smoothstep(1.0 - uSoft - 0.12, 1.0, r);
  float n = 1.0;
  if (uNoise > 0.0) {
    vec2 q = vUv * 3.2 + vSeed * 19.0;
    float v = vnoise(q) * 0.62 + vnoise(q * 2.3 + 5.0) * 0.38;
    n = mix(1.0, smoothstep(0.18, 0.78, v), uNoise);
  }
  float a = disc * n;
  a *= smoothstep(0.0, uFadeIn, vAge) * pow(max(1.0 - vAge, 0.0), uFadePow) * vAlive;
  vec3 col = mix(uColorA, uColorB, vAge) * uIntensity;
  col *= 1.0 + uFlicker * (vnoise(vec2(vSeed * 40.0, uTime * 11.0)) - 0.5) * 2.0;
  gl_FragColor = vec4(col, a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const DEFAULTS = {
  drag: 0,
  accel: new THREE.Vector3(),
  wobble: [0, 1] as [number, number],
  fadeIn: 0.08,
  fadePow: 1.4,
  stretch: 0,
  soft: 0.5,
  noise: 0,
  opacity: 1,
  intensity: 1,
  flicker: 0,
  colorA: new THREE.Color(1, 1, 1),
  colorB: new THREE.Color(1, 1, 1),
};

export class Particles extends THREE.Mesh {
  readonly isParticles = true;
  declare material: THREE.ShaderMaterial;
  private baseOpacity = 1;

  constructor(opts: ParticlesOpts) {
    const rnd = mulberry32(opts.seed ?? 1);
    const n = opts.count;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    const offset = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    const tmp = { offset: new THREE.Vector3(), vel: new THREE.Vector3() };
    for (let i = 0; i < n; i++) {
      tmp.offset.set(0, 0, 0);
      tmp.vel.set(0, 0, 0);
      opts.spawn(i, rnd, tmp);
      offset.set([tmp.offset.x, tmp.offset.y, tmp.offset.z], i * 3);
      vel.set([tmp.vel.x, tmp.vel.y, tmp.vel.z], i * 3);
      seed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 3));
    geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(vel, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = n;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: 1 },
        uOnce: { value: 0 },
        uDrag: { value: 0 },
        uStretch: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 0) },
        uAccel: { value: new THREE.Vector3() },
        uWobble: { value: new THREE.Vector2(0, 1) },
        uColorA: { value: new THREE.Color(1, 1, 1) },
        uColorB: { value: new THREE.Color(1, 1, 1) },
        uSoft: { value: 0.5 },
        uNoise: { value: 0 },
        uOpacity: { value: 1 },
        uIntensity: { value: 1 },
        uFlicker: { value: 0 },
        uFadeIn: { value: 0.08 },
        uFadePow: { value: 1.4 },
      },
    });
    super(geo, material);
    this.frustumCulled = false;
    this.renderOrder = 10;
    this.raycast = () => {};
  }

  emit(p: EmitParams): void {
    const u = this.material.uniforms;
    u.uTime.value = p.time;
    u.uLife.value = Math.max(0.01, p.life);
    u.uOnce.value = p.once ? 1 : 0;
    u.uSize.value.set(p.size0, p.size1 - p.size0);
    u.uDrag.value = p.drag ?? DEFAULTS.drag;
    (u.uAccel.value as THREE.Vector3).copy(p.accel ?? DEFAULTS.accel);
    (u.uWobble.value as THREE.Vector2).fromArray(p.wobble ?? DEFAULTS.wobble);
    u.uFadeIn.value = p.fadeIn ?? DEFAULTS.fadeIn;
    u.uFadePow.value = p.fadePow ?? DEFAULTS.fadePow;
    u.uStretch.value = p.stretch ?? DEFAULTS.stretch;
    u.uSoft.value = p.soft ?? DEFAULTS.soft;
    u.uNoise.value = p.noise ?? DEFAULTS.noise;
    u.uOpacity.value = p.opacity ?? DEFAULTS.opacity;
    u.uIntensity.value = p.intensity ?? DEFAULTS.intensity;
    u.uFlicker.value = p.flicker ?? DEFAULTS.flicker;
    (u.uColorA.value as THREE.Color).copy(p.colorA ?? DEFAULTS.colorA);
    (u.uColorB.value as THREE.Color).copy(p.colorB ?? DEFAULTS.colorB);
    this.baseOpacity = u.uOpacity.value;
    this.visible = p.opacity !== 0 && p.time > -0.001;
  }

  /** Extra global multiplier, e.g. for mobile quality scaling. */
  setFade(f: number): void {
    this.material.uniforms.uOpacity.value = this.baseOpacity * f;
  }
}

/** Disc emitter helper: uniform samples in a circle of radius r at height y, facing -Y. */
export const discSpawn = (r: number, speed: [number, number], spread: number) =>
  (i: number, rnd: () => number, out: { offset: THREE.Vector3; vel: THREE.Vector3 }) => {
    void i;
    const a = rnd() * Math.PI * 2;
    const rr = Math.sqrt(rnd()) * r;
    out.offset.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    const s = speed[0] + (speed[1] - speed[0]) * rnd();
    out.vel.set((rnd() - 0.5) * spread * s, -s, (rnd() - 0.5) * spread * s);
  };

/** Ring emitter: shoots outward horizontally from a ring of radius r (dust, pad smoke). */
export const ringSpawn = (rMin: number, rMax: number, speed: [number, number], up: [number, number]) =>
  (i: number, rnd: () => number, out: { offset: THREE.Vector3; vel: THREE.Vector3 }) => {
    void i;
    const a = rnd() * Math.PI * 2;
    const rr = rMin + (rMax - rMin) * rnd();
    out.offset.set(Math.cos(a) * rr, rnd() * 0.4, Math.sin(a) * rr);
    const s = speed[0] + (speed[1] - speed[0]) * rnd();
    out.vel.set(Math.cos(a) * s, up[0] + (up[1] - up[0]) * rnd(), Math.sin(a) * s);
  };
