import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl, materials } from '../../art/geo';
import { fbm2, mulberry32 } from '../../core/rand';

export const GROUND_Y = 6.2;
export const ROCKET_Y = 24.0; // base of the core stage, held above the deck by the hold-down posts
export const TOWER_X = -23;
export const DUCT_X = 34; // exhaust duct mouths, where the pad smoke comes out

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Merge many cylinders into one draw call. */
function truss(lines: [THREE.Vector3, THREE.Vector3, number][]): THREE.BufferGeometry {
  const up = V(0, 1, 0);
  const parts: THREE.BufferGeometry[] = [];
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const d = new THREE.Vector3();
  for (const [a, b, r] of lines) {
    d.subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, 6, 1);
    q.setFromUnitVectors(up, d.normalize());
    m.compose(a.clone().addScaledVector(d, len / 2), q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}

export interface Pad {
  group: THREE.Group;
  /** Swing-away service arms; rotate about Y to retract. */
  arms: THREE.Group[];
}

export function buildPad(): Pad {
  const M = materials();
  const group = new THREE.Group();
  const g = GROUND_Y;
  const white = M.white;
  const steel = M.metal;
  const red = M.red;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5c5e62, roughness: 0.92, metalness: 0.02 });
  const building = new THREE.MeshStandardMaterial({ color: 0xd9d6cc, roughness: 0.7, metalness: 0.02 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(1.0, 0.9, 0.7), emissiveIntensity: 3.2, roughness: 0.4 });

  // apron and exhaust trench
  group.add(cyl(320, 320, 0.5, concrete, 64, g - 0.5));
  group.add(box(74, 0.3, 15, new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 1 }), 0, g + 0.05, 0));
  for (const s of [-1, 1]) group.add(box(74, 2.2, 2.4, concrete, 0, g + 1.1, s * 8.8));

  // launch mount
  const mount = new THREE.Group();
  for (const [x, z] of [[-6.4, -6.4], [6.4, -6.4], [-6.4, 6.4], [6.4, 6.4]]) mount.add(box(2.2, 10.6, 2.2, steel, x, g + 5.3, z));
  mount.add(box(15.4, 1.8, 15.4, steel, 0, g + 11.2, 0));
for (const [x, z] of [[-6.6, -3.2], [6.6, -3.2], [-6.6, 3.2], [6.6, 3.2], [0, -3.2], [0, 3.2]]) {
    mount.add(box(1.3, ROCKET_Y - g - 12.1, 1.3, steel, x, g + 12.1 + (ROCKET_Y - g - 12.1) / 2, z));
    mount.add(box(2.2, 0.6, 2.0, red, x, ROCKET_Y - 0.3, z));
  }
  group.add(mount);

  // umbilical tower: tapered lattice with X-bracing
  const H = 98;
  const base = 7.4;
  const top = 5.6;
  const levels = 12;
  const lines: [THREE.Vector3, THREE.Vector3, number][] = [];
  const corner = (i: number, y: number) => {
    const k = base + (top - base) * (y / H);
    const sx = i % 2 === 0 ? -1 : 1;
    const sz = i < 2 ? -1 : 1;
    return V(sx * k, y, sz * k);
  };
  for (let i = 0; i < 4; i++) lines.push([corner(i, 0), corner(i, H), 0.62]);
  for (let l = 0; l <= levels; l++) {
    const y = (H / levels) * l;
    for (let i = 0; i < 4; i++) lines.push([corner(i, y), corner((i + 1) % 4, y), 0.3]);
    if (l < levels) {
      const y2 = (H / levels) * (l + 1);
      for (let i = 0; i < 4; i++) {
        lines.push([corner(i, y), corner((i + 1) % 4, y2), 0.2]);
        lines.push([corner((i + 1) % 4, y), corner(i, y2), 0.2]);
      }
    }
  }
  const tower = new THREE.Mesh(truss(lines), white);
  tower.position.set(TOWER_X, g, 0);
  group.add(tower);
  const topBox = box(9, 5, 9, white, TOWER_X, g + H + 2.5, 0);
  group.add(topBox);
  group.add(box(9.2, 0.9, 9.2, red, TOWER_X, g + H + 4.2, 0));
  const hammer = box(15, 1.6, 2.2, red, TOWER_X + 9, g + H + 6.2, 0);
  group.add(hammer);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const mast = cyl(0.26, 0.42, 27, steel, 8, g + H + 5.4 + 13.5);
    mast.position.x = TOWER_X + x * 3.6;
    mast.position.z = z * 3.6;
    group.add(mast);
  }

  // service arms reaching from the tower to the vehicle
  const arms: THREE.Group[] = [];
  for (const y of [36, 58, 80]) {
    const pivot = new THREE.Group();
    pivot.position.set(TOWER_X + 6.4, g + y, 0);
    const beam = new THREE.Mesh(truss([[V(0, -1.2, -1.2), V(17.5, -1.2, -1.2), 0.26], [V(0, -1.2, 1.2), V(17.5, -1.2, 1.2), 0.26], [V(0, 1.2, -1.2), V(17.5, 1.2, -1.2), 0.26], [V(0, 1.2, 1.2), V(17.5, 1.2, 1.2), 0.26], [V(0, 1.2, 1.2), V(17.5, -1.2, 1.2), 0.14], [V(0, 1.2, -1.2), V(17.5, -1.2, -1.2), 0.14], [V(17.5, -1.2, -1.2), V(17.5, 1.2, 1.2), 0.2]]), white);
    pivot.add(beam, box(4.5, 3.4, 4.2, white, 15.4, 0, 0));
    group.add(pivot);
    arms.push(pivot);
  }

  // water tower, floodlight masts, technical buildings, road. Both are placed so that the close shot at lift-off
  // (camera near +x +z, looking at the vehicle) sees neither: the masts sit beside or behind that camera, or behind
  // the vehicle and the tower.
  const wt = new THREE.Group();
  wt.position.set(160, g, -60);
  for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) wt.add(box(1.2, 80, 1.2, steel, x, 40, z));
  const tank = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 20), white);
  tank.position.y = 90;
  wt.add(tank, cyl(10.4, 10.4, 1.2, red, 32, 86.5));
  group.add(wt);
  for (const deg of [30, 110, 210, 234]) {
    const a = (deg * Math.PI) / 180;
    const x = Math.cos(a) * 62;
    const z = Math.sin(a) * 62;
    const pole = cyl(0.3, 0.5, 30, steel, 8, g + 15);
    pole.position.x = x;
    pole.position.z = z;
    group.add(pole);
    const head = box(3.2, 1.4, 0.8, lamp, x, g + 30.6, z);
    head.lookAt(0, g + 34, 0);
    group.add(head);
  }
  const rnd = mulberry32(77);
  for (let i = 0; i < 9; i++) {
    const w = 22 + rnd() * 30;
    const h = 9 + rnd() * 16;
    const d = 18 + rnd() * 24;
    group.add(box(w, h, d, building, -190 - rnd() * 170, g + h / 2, -150 - rnd() * 150));
  }
  group.add(box(7, 0.12, 210, new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.9 }), -150, g + 0.1, -95));

  // palms along the coast and around the apron
  const trunkGeo = new THREE.CylinderGeometry(0.24, 0.42, 10, 6);
  trunkGeo.translate(0, 5, 0);
  const frond: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 8; i++) {
    const f = new THREE.ConeGeometry(0.9, 5.6, 4);
    f.translate(0, 2.6, 0);
    f.rotateX(Math.PI / 2 - 0.55);
    f.rotateY((i / 8) * Math.PI * 2);
    f.translate(0, 10.2, 0);
    frond.push(f);
  }
  const crownGeo = mergeGeometries(frond)!;
  const N = 240;
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b5536, roughness: 0.9 }), N);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.8, side: THREE.DoubleSide }), N);
  const m4 = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  let n = 0;
  for (let i = 0; i < 2000 && n < N; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 400 + rnd() * 620;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z > 760 || x < -330) continue;
    if (fbm2(x * 0.01, z * 0.01, 2) < 0.42) continue;
    const s = 0.75 + rnd() * 0.6;
    qq.setFromAxisAngle(V(0, 1, 0), rnd() * Math.PI * 2);
    m4.compose(V(x, g + 0.1, z), qq, V(s, s, s));
    trunks.setMatrixAt(n, m4);
    crowns.setMatrixAt(n, m4);
    n++;
  }
  trunks.count = n;
  crowns.count = n;
  group.add(trunks, crowns);

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return { group, arms };
}
