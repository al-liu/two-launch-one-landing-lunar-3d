import * as THREE from 'three';
import { clamp } from '../core/easing';
import { WORLD_UP, type CamPose } from './types';

export interface CamKey {
  /** Act-local time. */
  t: number;
  pos: [number, number, number];
  look: [number, number, number];
  fov?: number;
  /** How motion arrives at this key: 'io' settles, 'lin' keeps moving, 'out' decelerates, 'in' accelerates. */
  ease?: 'io' | 'lin' | 'out' | 'in';
  /** Hard cut: no interpolation from the previous key. */
  cut?: boolean;
}

/**
 * Camera path through timed keys: monotone cubic Hermite per component on non-uniform knots.
 * Unlike Catmull-Rom it never overshoots, so a dolly-out towards a far-away key cannot dive
 * through the subject. Sampling is pure: same t, same camera.
 */
export class CamTrack {
  private keys: CamKey[];
  private pts: THREE.Vector3[];
  private looks: THREE.Vector3[];
  private mPos: THREE.Vector3[] = [];
  private mLook: THREE.Vector3[] = [];

  constructor(keys: CamKey[]) {
    this.keys = keys;
    this.pts = keys.map((k) => new THREE.Vector3().fromArray(k.pos));
    this.looks = keys.map((k) => new THREE.Vector3().fromArray(k.look));
    this.mPos = this.tangents(this.pts);
    this.mLook = this.tangents(this.looks);
  }

  /** Per-key tangents (units per second). Zero at cuts, at easing keys and at local extrema. */
  private tangents(p: THREE.Vector3[]): THREE.Vector3[] {
    const n = this.keys.length;
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Vector3();
      const prev = this.keys[i - 1];
      const next = this.keys[i + 1];
      const settle = (next && (next.cut || next.ease === 'io' || next.ease === 'out')) || (prev && (prev.cut || this.keys[i].ease === 'io' || this.keys[i].ease === 'in'));
      if (prev && next && !settle) {
        const h0 = this.keys[i].t - prev.t;
        const h1 = next.t - this.keys[i].t;
        for (let c = 0; c < 3; c++) {
          const d0 = (p[i].getComponent(c) - p[i - 1].getComponent(c)) / h0;
          const d1 = (p[i + 1].getComponent(c) - p[i].getComponent(c)) / h1;
          // Butland's three-point slope: stays between the two segment slopes, so nothing overshoots
          if (d0 * d1 > 0) m.setComponent(c, (3 * (h0 + h1)) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1));
        }
      }
      out.push(m);
    }
    return out;
  }

  sample(t: number, out: CamPose): CamPose {
    const n = this.keys.length;
    if (n === 0) return out;
    if (t <= this.keys[0].t) return this.set(0, out);
    let i = 0;
    while (i < n - 2 && t >= this.keys[i + 1].t) i++;
    const a = this.keys[i];
    const b = this.keys[i + 1];
    if (t >= b.t) return this.set(i + 1, out);
    const h = Math.max(1e-4, b.t - a.t);
    const s = clamp((t - a.t) / h);
    if (b.cut) return this.set(i + 1, out);
    const s2 = s * s;
    const s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1;
    const h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2;
    const h11 = s3 - s2;
    const hermite = (p: THREE.Vector3[], m: THREE.Vector3[], v: THREE.Vector3) =>
      v.copy(p[i]).multiplyScalar(h00).addScaledVector(m[i], h10 * h).addScaledVector(p[i + 1], h01).addScaledVector(m[i + 1], h11 * h);
    hermite(this.pts, this.mPos, out.pos);
    hermite(this.looks, this.mLook, out.look);
    const fa = a.fov ?? 40;
    out.fov = fa + ((b.fov ?? fa) - fa) * h01;
    out.up.copy(WORLD_UP);
    return out;
  }

  private set(i: number, out: CamPose): CamPose {
    const k = this.keys[Math.min(i, this.keys.length - 1)];
    out.pos.copy(this.pts[i]);
    out.look.copy(this.looks[i]);
    out.fov = k.fov ?? 40;
    out.up.copy(WORLD_UP);
    return out;
  }
}
