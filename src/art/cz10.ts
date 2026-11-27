import * as THREE from 'three';
import { canvasTexture, flagCanvas } from './textures';
import { cyl, decal, lathe, materials, nozzle, textCanvas } from './geo';

export interface Rocket {
  /** Origin at the base of the core stage, +Y up. Total height 92.5 m. */
  root: THREE.Group;
  boosters: [THREE.Group, THREE.Group];
  core1: THREE.Group;
  core2: THREE.Group;
  core3: THREE.Group;
  fairing: [THREE.Group, THREE.Group] | null;
  payload: THREE.Group;
  /** Local nozzle-exit positions: core cluster (in root space), each booster, stage 2, stage 3. */
  exits: { boosters: THREE.Vector3[][]; core: THREE.Vector3; stage2: THREE.Vector3; stage3: THREE.Vector3 };
}

export const R = 2.5;
const H1 = 34;
const Y2 = 36.5;
const H2 = 13.5;
const Y3 = 51.5;
const H3 = 13;
export const Y_TOP = 66.5;

const DOUBLE_WHITE = new THREE.MeshStandardMaterial({ color: 0xf4f3ee, roughness: 0.5, metalness: 0.05, side: THREE.DoubleSide });

function engineCluster(parent: THREE.Group, spots: [number, number][], re: number, len: number, y: number): THREE.Vector3[] {
  return spots.map(([x, z]) => {
    const n = nozzle(re * 0.42, re, len, y, 28);
    n.position.x = x;
    n.position.z = z;
    parent.add(n);
    return new THREE.Vector3(x, y, z);
  });
}

const ring6 = (r: number): [number, number][] => [0, 1, 2, 3, 4, 5].map((i) => [Math.cos((i / 6) * Math.PI * 2) * r, Math.sin((i / 6) * Math.PI * 2) * r]);

/** Booster nose: cylinder cap slanted so it leans away from the core. */
function slantedNose(r: number, h: number, outward: number): THREE.BufferGeometry {
  const N = 40;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= N; j++) {
    const a = (j / N) * Math.PI * 2;
    const c = Math.cos(a) * outward; // 1 on the outer side
    pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
    pos.push(Math.sin(a) * r * 0.04, h * (0.34 + 0.66 * (0.5 + 0.5 * c)), Math.cos(a) * r * 0.04);
  }
  for (let j = 0; j < N; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildRocket(kind: 'lander' | 'ship', payload: THREE.Object3D): Rocket {
  const M = materials();
  const root = new THREE.Group();
  const flag = canvasTexture(flagCanvas(480, 320));
  const cn = textCanvas('中国航天', '#c8102e');

  // ---- core stage 1 + boosters ------------------------------------------------
  const core1 = new THREE.Group();
  const coreTank = cyl(R, R, H1, M.hull, 64);
  core1.add(coreTank);
  core1.add(cyl(R + 0.01, R + 0.01, 2.6, M.dark, 64));
  core1.add(cyl(R + 0.012, R + 0.012, 0.6, M.red, 64, H1 - 2.2));
  core1.add(cyl(R + 0.012, R + 0.012, 0.25, M.red, 64, H1 - 3.2));
  core1.add(cyl(R + 0.012, R + 0.012, 1.4, M.offwhite, 64, H1 - 6.2));
  decal(3.0, 2.0, flag, R + 0.03, 0, 24.5, core1);
  decal(3.0, 2.0, flag, R + 0.03, Math.PI, 24.5, core1);
  decal(5.2, 1.3, cn, R + 0.03, 0, 21.4, core1);
  decal(5.2, 1.3, cn, R + 0.03, Math.PI, 21.4, core1);
  const coreExits = engineCluster(core1, [[0, 0], ...ring6(1.62)], 0.86, 3.3, -3.4);

  const boosters: [THREE.Group, THREE.Group] = [new THREE.Group(), new THREE.Group()];
  const boosterExits: THREE.Vector3[][] = [];
  boosters.forEach((b, i) => {
    const side = i === 0 ? 1 : -1;
    b.position.x = side * (R * 2);
    b.add(cyl(R, R, 27, M.hull, 64));
    b.add(cyl(R + 0.01, R + 0.01, 2.2, M.dark, 64));
    b.add(cyl(R + 0.012, R + 0.012, 0.5, M.red, 64, 23.6));
    const nose = new THREE.Mesh(slantedNose(R, 6.4, side), M.white);
    nose.position.y = 27;
    b.add(nose);
    decal(2.6, 1.74, flag, R + 0.03, 0, 17.5, b);
    decal(2.6, 1.74, flag, R + 0.03, Math.PI, 17.5, b);
    boosterExits.push(engineCluster(b, [[0.95, 0], [-0.95, 0]], 0.8, 3.2, -3.3));
    root.add(b);
  });
  root.add(core1);

  // ---- stage 2 -----------------------------------------------------------------------
  const core2 = new THREE.Group();
  core2.position.y = Y2;
  core2.add(cyl(R, R, H2, M.hull, 64));
  core2.add(cyl(R + 0.012, R + 0.012, 0.4, M.red, 64, H2 - 1.6));
  const e2 = nozzle(0.34, 0.8, 2.6, -2.9, 28);
  e2.position.x = 0.85;
  core2.add(e2);
  const e2b = e2.clone();
  e2b.position.x = -0.85;
  core2.add(e2b);
  root.add(core2);
  // interstage 1 stays with the first stage
  core1.add(cyl(R + 0.005, R + 0.005, Y2 - H1, M.dark, 64, H1));

  // ---- stage 3 + adapter ---------------------------------------------------------
  const core3 = new THREE.Group();
  core3.position.y = Y3;
  core3.add(cyl(R, R, H3, M.hull, 64));
  core3.add(cyl(R + 0.012, R + 0.012, 0.35, M.red, 64, H3 - 1.2));
  const e3 = nozzle(0.3, 0.98, 2.9, -3.2, 28);
  e3.position.x = 0.7;
  core3.add(e3);
  const e3b = e3.clone();
  e3b.position.x = -0.7;
  core3.add(e3b);
  const adapterTop = kind === 'lander' ? 3.2 : 2.35;
  core3.add(cyl(R, adapterTop, Y_TOP - Y3 - H3, M.offwhite, 64, H3));
  root.add(core3);
  core2.add(cyl(R + 0.005, R + 0.005, Y3 - Y2 - H2, M.dark, 64, H2));

  // ---- fairing (lander) or exposed ship -------------------------------------------------
  let fairing: [THREE.Group, THREE.Group] | null = null;
  const pay = new THREE.Group();
  pay.position.y = Y_TOP - Y3;
  if (kind === 'lander') {
    const prof: [number, number][] = [[3.2, 0]];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      prof.push([Math.max(0.02, 3.2 * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.04 * t) + 0.02 * (1 - t)), 13 + 13 * t]);
    }
    const mk = (phi0: number) => {
      const pivot = new THREE.Group();
      const shell = lathe(prof, DOUBLE_WHITE, 28, phi0, Math.PI);
      pivot.add(shell);
      pivot.position.y = Y_TOP - Y3;
      return pivot;
    };
    const h1 = mk(0);
    const h2 = mk(Math.PI);
    core3.add(h1, h2);
    fairing = [h1, h2];
    payload.scale.setScalar(0.5);
    payload.position.y = 0.3;
  } else {
    payload.position.y = 0;
  }
  pay.add(payload);
  core3.add(pay);

  return {
    root,
    boosters,
    core1,
    core2,
    core3,
    fairing,
    payload: pay,
    exits: {
      boosters: boosterExits,
      core: coreExits[0].clone().set(0, -3.4, 0),
      stage2: new THREE.Vector3(0, -2.9, 0),
      stage3: new THREE.Vector3(0, -3.2, 0),
    },
  };
}
