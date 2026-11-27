import * as THREE from 'three';
import { Plume, box, cyl, lathe, materials, nozzle, strut } from './geo';

export interface Ship {
  root: THREE.Group;
  capsule: THREE.Group;
  service: THREE.Group;
  tower: THREE.Group;
  solar: THREE.Group[];
  /** Centre of the main engine plume (local). */
  enginePos: THREE.Vector3;
  /** Nose docking ring centre (local). */
  nose: THREE.Vector3;
  /** Heat shield: the dish under the capsule that takes the brunt of re-entry. */
  shield: THREE.Mesh<THREE.LatheGeometry, THREE.MeshStandardMaterial>;
  /** Metal of the capsule's lower wall; glows from the shock layer during re-entry. */
  wall: THREE.MeshStandardMaterial;
  setTower(visible: boolean): void;
  setSolar(k: number): void;
}

const SM_H = 7;
const CAP_H = 6;

/** 梦舟: inverted-cone return capsule on a cylindrical service module, with two solar wings. Origin at the base of the service module, +Y towards the nose. */
export function buildShip(): Ship {
  const M = materials();
  const root = new THREE.Group();
  root.userData.part = 'ship';

  // ---- service module -------------------------------------------------------
  const service = new THREE.Group();
  service.userData.part = 'serviceModule';
  const sm = lathe(
    [
      [0.9, 0.1],
      [2.05, 0.1],
      [2.25, 0.5],
      [2.3, 2.0],
      [2.45, SM_H - 0.5],
      [2.45, SM_H],
      [0, SM_H],
    ],
    M.silverFoil,
  );
  service.add(sm);
  service.add(cyl(2.46, 2.46, 0.5, M.dark, 48, 1.0));
  service.add(cyl(2.5, 2.5, 0.22, M.red, 48, SM_H - 1.1));
  service.add(cyl(2.51, 2.51, 1.3, M.offwhite, 48, 2.4));
  // engines: one main + four outer
  service.add(nozzle(0.28, 0.62, 1.3, -1.25));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const n = nozzle(0.12, 0.34, 0.8, -0.8, 20);
    n.position.x = Math.cos(a) * 1.55;
    n.position.z = Math.sin(a) * 1.55;
    service.add(n);
  }
  // RCS pods
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    service.add(box(0.5, 0.7, 0.34, M.dark, Math.cos(a) * 2.46, 4.3, Math.sin(a) * 2.46));
  }
  root.add(service);

  // ---- return capsule ---------------------------------------------------------
  const capsule = new THREE.Group();
  capsule.userData.part = 'capsule';
  capsule.position.y = SM_H;
  const wall = new THREE.MeshStandardMaterial({ color: 0xb48a52, roughness: 0.38, metalness: 0.75 });
  const lower = lathe(
    [
      [2.3, 0],
      [2.55, 1.3],
      [2.86, 3.1],
      [3.0, 4.2],
      [2.98, 4.5],
    ],
    wall,
  );
  const upper = lathe(
    [
      [2.98, 4.5],
      [2.82, 4.95],
      [2.3, 5.45],
      [1.65, 5.78],
      [1.05, 5.9],
      [0.95, CAP_H],
      [0, CAP_H],
    ],
    M.offwhite,
  );
  const shield = lathe(
    [
      [0, -0.55],
      [1.3, -0.5],
      [2.0, -0.32],
      [2.36, 0.02],
      [2.3, 0.1],
      [0, 0.1],
    ],
    new THREE.MeshStandardMaterial({ color: 0x4a3a30, roughness: 0.85, metalness: 0.25 }),
  ) as THREE.Mesh<THREE.LatheGeometry, THREE.MeshStandardMaterial>;
  capsule.add(lower, upper, shield);
  // panel seams
  for (const y of [1.3, 2.5, 3.6]) {
    const r = 2.3 + (y / 4.2) * 0.7;
    capsule.add(cyl(r + 0.012, r + 0.012 + 0.05, 0.05, M.dark, 64, y, true));
  }
  // docking ring
  capsule.add(cyl(0.98, 0.92, 0.42, M.dark, 32, CAP_H - 0.02));
  capsule.add(cyl(0.62, 0.62, 0.1, M.black, 24, CAP_H + 0.36));
  // windows
  for (const a of [Math.PI / 2 - 0.42, Math.PI / 2 + 0.42]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.06), M.glass);
    const r = 2.84;
    w.position.set(Math.cos(a) * r, 4.62, Math.sin(a) * r);
    w.rotation.y = -a + Math.PI / 2;
    w.rotation.x = -0.5;
    capsule.add(w);
  }
  // small thrusters on the shoulder
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    capsule.add(box(0.2, 0.2, 0.2, M.dark, Math.cos(a) * 2.72, 5.1, Math.sin(a) * 2.72));
  }
  root.add(capsule);

  // ---- escape tower -------------------------------------------------------------
  const tower = new THREE.Group();
  tower.userData.part = 'escapeTower';
  tower.position.y = SM_H + CAP_H;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tower.add(strut(new THREE.Vector3(Math.cos(a) * 1.9, 0.2, Math.sin(a) * 1.9), new THREE.Vector3(Math.cos(a) * 0.36, 6.2, Math.sin(a) * 0.36), 0.07, M.metal, 6));
  }
  for (let i = 0; i < 4; i++) {
    const a0 = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const a1 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
    const p = (a: number, k: number) => new THREE.Vector3(Math.cos(a) * (1.9 - 1.54 * k), 0.2 + 6 * k, Math.sin(a) * (1.9 - 1.54 * k));
    for (const k of [0.34, 0.67]) tower.add(strut(p(a0, k), p(a1, k), 0.04, M.metal, 6));
    tower.add(strut(p(a0, 0.02), p(a1, 0.34), 0.035, M.metal, 6));
    tower.add(strut(p(a1, 0.02), p(a0, 0.34), 0.035, M.metal, 6));
    tower.add(strut(p(a0, 0.34), p(a1, 0.67), 0.035, M.metal, 6));
    tower.add(strut(p(a1, 0.34), p(a0, 0.67), 0.035, M.metal, 6));
  }
  tower.add(cyl(0.42, 0.42, 0.5, M.dark, 24, 6.1));
  const motor = new THREE.Group();
  motor.position.y = 6.6;
  motor.add(cyl(0.62, 0.62, 5.6, M.white, 32));
  motor.add(cyl(0.64, 0.64, 0.5, M.red, 32, 4.6));
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.white);
  nose.scale.y = 1.7;
  nose.position.y = 5.6;
  motor.add(nose);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const n = nozzle(0.09, 0.22, 0.5, -0.5, 16);
    n.position.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36);
    n.rotation.x = 0.25;
    motor.add(n);
  }
  tower.add(motor);
  root.add(tower);

  // ---- solar wings --------------------------------------------------------------
  const solar: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(side * 2.4, 4.2, 0);
    const boom = cyl(0.06, 0.06, 2.4, M.metal, 8);
    boom.position.x = side * 1.2;
    wing.add(boom);
    const leaves = new THREE.Group();
    leaves.position.x = side * 2.3;
    const panel = (len: number, y: number) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 2.6), M.solar);
      p.position.set((side * len) / 2, y, 0);
      leaves.add(p);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(len + 0.08, 0.03, 2.7), M.metal);
      frame.position.set((side * len) / 2, y - 0.045, 0);
      leaves.add(frame);
    };
    panel(5.2, 0);
    panel(3.6, -0.09);
    wing.add(leaves);
    wing.userData.leaves = leaves;
    root.add(wing);
    solar.push(wing);
  }

  return {
    root,
    capsule,
    service,
    tower,
    solar,
    enginePos: new THREE.Vector3(0, -1.3, 0),
    nose: new THREE.Vector3(0, SM_H + CAP_H + 0.42, 0),
    shield,
    wall,
    setTower(v) {
      tower.visible = v;
    },
    setSolar(k) {
      for (const w of solar) {
        (w.userData.leaves as THREE.Group).scale.set(k, 1, 1);
      }
    },
  };
}

/** Engine glow for the service module: a short plume under the stack. */
export function shipPlume(): Plume {
  return new Plume(new THREE.Color(0.55, 0.72, 1.0), 14, 1.5);
}
