import * as THREE from 'three';
import { box, cyl, lathe, materials, nozzle, strut } from './geo';

export interface Lander {
  /** Origin at footpad level, +Y up. */
  root: THREE.Group;
  descent: THREE.Group;
  ascent: THREE.Group;
  legs: THREE.Group;
  /** Main engine nozzle exit (local). */
  mainEngine: THREE.Vector3;
  /** Ascent engine nozzle exits (local to the ascent group). */
  ascentEngines: THREE.Vector3[];
  /** Docking port centre (local). */
  top: THREE.Vector3;
  hatch: THREE.Vector3;
  /** Swings the side hatch open (rotation.y, 0 = closed). */
  hatchHinge: THREE.Group;
}

const BODY_Y = 1.7;
const BODY_H = 3.9;
const ASC_Y = BODY_Y + BODY_H + 0.2;
const ASC_R = 1.95;
const ASC_H = 3.6;
const LEG_R = 4.9;
const PORCH_Y = ASC_Y + 0.15;

/** 揽月: lower descent stage (推进舱) with four legs, upper ascent cabin (登月舱) with a docking port on top. */
export function buildLander(): Lander {
  const M = materials();
  const root = new THREE.Group();
  root.userData.part = 'lander';

  // ---- descent stage ------------------------------------------------------------
  const descent = new THREE.Group();
  descent.userData.part = 'descentStage';
  const oct = (r: number, h: number, y: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), mat);
    m.position.y = y + h / 2;
    m.rotation.y = Math.PI / 8;
    descent.add(m);
    return m;
  };
  oct(2.78, 0.3, BODY_Y - 0.3, M.dark);
  oct(2.6, BODY_H, BODY_Y, M.gold);
  oct(2.72, 0.22, BODY_Y + BODY_H, M.offwhite);
  // equipment bays and tanks on the faces
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = 2.6 * Math.cos(Math.PI / 8);
    const mat = i % 2 === 0 ? M.silverFoil : M.goldDark;
    const b = box(1.75, 1.5, 0.14, mat, Math.cos(a) * (r + 0.05), BODY_Y + 1.15, Math.sin(a) * (r + 0.05));
    b.rotation.y = -a + Math.PI / 2;
    descent.add(b);
  }
  descent.add(nozzle(0.42, 0.92, 1.5, 0.35, 40));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const n = nozzle(0.1, 0.24, 0.55, BODY_Y - 0.25, 16);
    n.position.x = Math.cos(a) * 2.1;
    n.position.z = Math.sin(a) * 2.1;
    descent.add(n);
  }
  // ladder down the +Z face of the descent stage, with a porch under the hatch
  const LAD_Z = 2.62;
  for (const x of [-0.26, 0.26]) descent.add(strut(new THREE.Vector3(x, 0.4, LAD_Z), new THREE.Vector3(x, PORCH_Y + 0.9, LAD_Z), 0.035, M.metal, 6));
  for (let k = 0; k < 14; k++) {
    const y = 0.75 + k * 0.39;
    descent.add(strut(new THREE.Vector3(-0.26, y, LAD_Z), new THREE.Vector3(0.26, y, LAD_Z), 0.028, M.metal, 6));
  }
  descent.add(box(0.86, 0.05, 0.95, M.metal, 0, PORCH_Y, LAD_Z - 0.5));
  for (const x of [-0.4, 0.4]) descent.add(strut(new THREE.Vector3(x, PORCH_Y, 1.9), new THREE.Vector3(x, PORCH_Y + 0.95, 1.9), 0.03, M.metal, 6));
  root.add(descent);

  // ---- legs -----------------------------------------------------------------------
  const legs = new THREE.Group();
  legs.userData.part = 'legs';
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const foot = dir.clone().multiplyScalar(LEG_R).setY(0.3);
    const hip = dir.clone().multiplyScalar(2.3).setY(BODY_Y + BODY_H - 0.5);
    const mid = foot.clone().lerp(hip, 0.5);
    legs.add(strut(hip, foot, 0.13, M.metal));
    for (const s of [-1, 1]) {
      legs.add(strut(dir.clone().multiplyScalar(2.45).addScaledVector(side, s * 0.9).setY(BODY_Y + 0.9), mid, 0.06, M.metal));
    }
    const pad = cyl(0.82, 0.72, 0.16, M.goldDark, 24);
    pad.position.copy(foot).setY(0.08);
    legs.add(pad);
    const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), M.dark);
    ankle.position.copy(foot);
    legs.add(ankle);
  }
  root.add(legs);

  // ---- ascent stage ------------------------------------------------------------------
  const ascent = new THREE.Group();
  ascent.userData.part = 'ascentStage';
  ascent.position.y = ASC_Y;
  ascent.add(cyl(ASC_R, ASC_R, ASC_H, M.cream, 48));
  ascent.add(cyl(ASC_R + 0.012, ASC_R + 0.012, 0.5, M.dark, 48, 1.75, true));
  ascent.add(cyl(ASC_R + 0.012, ASC_R + 0.012, 0.12, M.red, 48, 0.35, true));
  const dome = lathe(
    [
      [ASC_R, ASC_H],
      [1.8, ASC_H + 0.5],
      [1.3, ASC_H + 0.95],
      [0.92, ASC_H + 1.1],
      [0, ASC_H + 1.1],
    ],
    M.offwhite,
  );
  ascent.add(dome);
  ascent.add(cyl(0.9, 0.86, 0.55, M.dark, 32, ASC_H + 1.05));
  ascent.add(cyl(0.58, 0.58, 0.08, M.black, 24, ASC_H + 1.58));
  // windows and hatch (+Z side)
  for (const x of [-0.62, 0.62]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.08), M.glass);
    w.position.set(x, 2.55, Math.sqrt(ASC_R * ASC_R - x * x) + 0.01);
    w.rotation.y = Math.asin(x / ASC_R);
    ascent.add(w);
  }
  ascent.add(box(0.78, 1.15, 0.1, M.dark, 0, 1.05, ASC_R + 0.03));
  // dark inner shell, so an open hatch looks into a cabin instead of out the other side
  const inner = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.9, metalness: 0, side: THREE.BackSide });
  ascent.add(cyl(ASC_R - 0.04, ASC_R - 0.04, ASC_H - 0.08, inner, 40, 0.04));
  ascent.add(cyl(ASC_R - 0.05, ASC_R - 0.05, 0.08, inner, 40, 0.1));
  // hinged door on the +Z face
  const hatchHinge = new THREE.Group();
  hatchHinge.position.set(-0.3, 1.05, ASC_R + 0.12);
  const door = box(0.6, 0.95, 0.06, M.offwhite, 0.3, 0, 0);
  door.userData.part = 'ascentStage';
  hatchHinge.add(door);
  ascent.add(hatchHinge);
  // RCS quads, antennas
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ascent.add(box(0.34, 0.34, 0.34, M.dark, Math.cos(a) * (ASC_R + 0.12), ASC_H - 0.35, Math.sin(a) * (ASC_R + 0.12)));
  }
  const mast = cyl(0.03, 0.03, 1.3, M.metal, 6, ASC_H + 0.4);
  mast.position.x = -1.2;
  ascent.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), M.white);
  dish.material = new THREE.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide });
  dish.position.set(-1.2, ASC_H + 1.7, 0);
  dish.rotation.z = 0.9;
  ascent.add(dish);
  // ascent engines around the base
  const ascentEngines: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const n = nozzle(0.14, 0.4, 1.0, -0.75, 20);
    n.position.set(Math.cos(a) * 1.72, 0, Math.sin(a) * 1.72);
    ascent.add(n);
    ascentEngines.push(new THREE.Vector3(Math.cos(a) * 1.72, -0.75, Math.sin(a) * 1.72));
  }
  root.add(ascent);

  return {
    root,
    descent,
    ascent,
    legs,
    mainEngine: new THREE.Vector3(0, 0.35, 0),
    ascentEngines,
    top: new THREE.Vector3(0, ASC_Y + ASC_H + 1.62, 0),
    hatch: new THREE.Vector3(0, ASC_Y + 0.5, ASC_R + 0.2),
    hatchHinge,
  };
}
