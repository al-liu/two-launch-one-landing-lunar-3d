import * as THREE from 'three';
import { canvasTexture, flagCanvas, makeCanvas } from './textures';
import { box, cyl, materials, strut } from './geo';

const M = () => materials();

// ---------------------------------------------------------------------------
// 望宇登月服: ~1.9 m tall, origin between the feet.
// ---------------------------------------------------------------------------
export interface Astronaut {
  root: THREE.Group;
  body: THREE.Group;
  neck: THREE.Group;
  joints: {
    shoulderL: THREE.Group; shoulderR: THREE.Group; elbowL: THREE.Group; elbowR: THREE.Group;
    hipL: THREE.Group; hipR: THREE.Group; kneeL: THREE.Group; kneeR: THREE.Group;
  };
  pose(p: Pose): void;
}

export interface Pose {
  /** 0 = stand, 1 = full stride. */
  walk: number;
  phase: number;
  /** Hip pitch: 0 upright, ~1.5 sitting. */
  sit?: number;
  armL?: [number, number];
  armR?: [number, number];
  lean?: number;
}

function limb(parent: THREE.Object3D, x: number, y: number, len: number, r0: number, r1: number): THREE.Group {
  const j = new THREE.Group();
  j.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r0, len - r0 * 2, 4, 12), M().suit);
  m.scale.set(1, 1, r1 / r0);
  m.position.y = -len / 2;
  j.add(m);
  parent.add(j);
  return j;
}

export function buildAstronaut(): Astronaut {
  const mat = M();
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.02;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.3, 6, 16), mat.suit);
  torso.scale.set(1.16, 1, 0.86);
  body.add(torso);
  // red stripes and flag patch
  body.add(box(0.3, 0.05, 0.01, mat.red, -0.14, 0.12, 0.22));
  body.add(box(0.16, 0.11, 0.012, mat.red, 0.2, 0.2, 0.12));
  const pack = box(0.5, 0.56, 0.2, mat.offwhite, 0, 0.06, -0.27);
  body.add(pack);
  body.add(box(0.26, 0.16, 0.06, mat.dark, 0, 0.02, 0.225));
  for (const x of [-0.09, 0.09]) body.add(box(0.05, 0.05, 0.05, mat.red, x, 0.02, 0.265));

  const neck = new THREE.Group();
  neck.position.y = 0.34;
  body.add(neck);
  neck.add(cyl(0.15, 0.17, 0.08, mat.metal, 20));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 24, 16), mat.suit);
  helmet.position.y = 0.2;
  neck.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.197, 24, 16, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.24, Math.PI * 0.5), mat.visor);
  visor.position.y = 0.2;
  neck.add(visor);
  for (const x of [-0.1, 0.1]) {
    const l = cyl(0.028, 0.028, 0.05, mat.dark, 12);
    l.position.set(x, 0.36, 0.13);
    l.rotation.x = Math.PI / 2 - 0.4;
    neck.add(l);
  }

  const shoulderL = limb(body, -0.32, 0.22, 0.3, 0.085, 0.085);
  const shoulderR = limb(body, 0.32, 0.22, 0.3, 0.085, 0.085);
  const elbowL = limb(shoulderL, 0, -0.3, 0.3, 0.075, 0.075);
  const elbowR = limb(shoulderR, 0, -0.3, 0.3, 0.075, 0.075);
  for (const e of [elbowL, elbowR]) {
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), mat.offwhite);
    g.position.y = -0.3;
    e.add(g);
    e.add(box(0.1, 0.05, 0.012, mat.red, 0, -0.16, 0.078));
  }
  const hipL = limb(root, -0.14, 0.98, 0.46, 0.105, 0.105);
  const hipR = limb(root, 0.14, 0.98, 0.46, 0.105, 0.105);
  const kneeL = limb(hipL, 0, -0.46, 0.46, 0.095, 0.095);
  const kneeR = limb(hipR, 0, -0.46, 0.46, 0.095, 0.095);
  for (const k of [kneeL, kneeR]) {
    const boot = box(0.17, 0.12, 0.34, mat.offwhite, 0, -0.47, 0.07);
    k.add(boot);
  }

  const pose = (p: Pose) => {
    const s = Math.sin(p.phase);
    const c = Math.cos(p.phase);
    const w = p.walk;
    hipL.rotation.x = s * 0.5 * w;
    hipR.rotation.x = -s * 0.5 * w;
    kneeL.rotation.x = Math.max(0, -c) * 0.7 * w;
    kneeR.rotation.x = Math.max(0, c) * 0.7 * w;
    shoulderL.rotation.x = -s * 0.45 * w + (p.armL?.[0] ?? 0.12);
    shoulderR.rotation.x = s * 0.45 * w + (p.armR?.[0] ?? 0.12);
    shoulderL.rotation.z = 0.14 + (p.armL?.[1] ?? 0);
    shoulderR.rotation.z = -0.14 - (p.armR?.[1] ?? 0);
    elbowL.rotation.x = -0.25 - Math.max(0, s) * 0.35 * w;
    elbowR.rotation.x = -0.25 - Math.max(0, -s) * 0.35 * w;
    const sit = p.sit ?? 0;
    hipL.rotation.x -= sit * 1.45;
    hipR.rotation.x -= sit * 1.45;
    kneeL.rotation.x += sit * 1.35;
    kneeR.rotation.x += sit * 1.35;
    body.position.y = 1.02 - sit * 0.36 + Math.abs(c) * 0.04 * w;
    body.rotation.x = (p.lean ?? 0) + sit * 0.12;
    neck.rotation.x = -sit * 0.25 + Math.sin(p.phase * 2) * 0.03 * w;
  };
  pose({ walk: 0, phase: 0 });
  return { root, body, neck, joints: { shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR }, pose };
}

// ---------------------------------------------------------------------------
// 探索载人月球车: ~3.2 m long, origin on the ground between the wheels, drives towards +X.
// ---------------------------------------------------------------------------
export interface Rover {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  flagTime: { value: number };
  mast: THREE.Group;
  seats: [THREE.Vector3, THREE.Vector3];
  sampleBox: THREE.Mesh;
}

export function buildRover(): Rover {
  const mat = M();
  const root = new THREE.Group();
  root.add(box(2.9, 0.26, 1.7, mat.gold, 0, 0.66, 0));
  root.add(box(2.6, 0.16, 1.5, mat.silverFoil, 0, 0.48, 0));
  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of [[1.12, 1.0], [1.12, -1.0], [-1.12, 1.0], [-1.12, -1.0]]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 28), mat.tire);
    tire.rotation.x = Math.PI / 2;
    const spin = new THREE.Group();
    spin.add(tire);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      spin.add(box(0.07, 0.05, 0.32, mat.offwhite, Math.cos(a) * 0.41, Math.sin(a) * 0.41, 0));
    }
    w.add(spin);
    w.position.set(x, 0.42, z);
    root.add(w);
    wheels.push(spin);
    root.add(strut(new THREE.Vector3(x, 0.42, z * 0.62), new THREE.Vector3(x, 0.42, z), 0.05, mat.metal));
  }
  const seats: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(0.15, 0.0, 0.46), new THREE.Vector3(0.15, 0.0, -0.46)];
  for (const s of seats) {
    root.add(box(0.52, 0.1, 0.5, mat.dark, s.x, 0.9, s.z));
    root.add(box(0.1, 0.52, 0.5, mat.dark, s.x - 0.26, 1.16, s.z));
    root.add(strut(new THREE.Vector3(s.x, 0.79, s.z - 0.18), new THREE.Vector3(s.x, 0.88, s.z - 0.18), 0.03, mat.metal));
    root.add(strut(new THREE.Vector3(s.x, 0.79, s.z + 0.18), new THREE.Vector3(s.x, 0.88, s.z + 0.18), 0.03, mat.metal));
  }
  root.add(box(0.16, 0.3, 1.5, mat.offwhite, 0.78, 1.02, 0));
  root.add(strut(new THREE.Vector3(0.7, 1.0, 0.2), new THREE.Vector3(0.52, 1.28, 0.2), 0.022, mat.dark));
  for (const z of [-0.6, 0.6]) {
    const lamp = cyl(0.09, 0.09, 0.08, mat.glass, 16);
    lamp.rotation.z = Math.PI / 2;
    lamp.position.set(1.47, 0.8, z);
    root.add(lamp);
  }
  const mast = new THREE.Group();
  mast.position.set(0.45, 0.8, 0);
  mast.add(cyl(0.035, 0.035, 1.15, mat.metal, 8, 0.57));
  const head = new THREE.Group();
  head.position.y = 1.2;
  head.add(box(0.34, 0.16, 0.22, mat.offwhite, 0, 0, 0));
  for (const x of [-0.09, 0.09]) {
    const eye = cyl(0.045, 0.045, 0.05, mat.glass, 12);
    eye.rotation.z = Math.PI / 2;
    eye.position.set(x + 0.19, 0, 0);
    head.add(eye);
  }
  mast.add(head);
  root.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), mat.white);
  dish.position.set(-1.1, 1.5, -0.3);
  dish.rotation.z = -0.7;
  root.add(dish);
  root.add(strut(new THREE.Vector3(-1.1, 0.8, -0.3), new THREE.Vector3(-1.1, 1.42, -0.3), 0.025, mat.metal));
  const panel = box(1.0, 0.04, 1.5, mat.solar, -0.85, 1.26, 0.3);
  panel.rotation.z = -0.42;
  root.add(panel);
  const sampleBox = box(0.5, 0.3, 0.6, mat.offwhite, -1.25, 0.95, 0.55);
  root.add(sampleBox);
  // national flag on a pole at the rear corner
  const pole = cyl(0.018, 0.018, 1.5, mat.metal, 8, 0.78);
  pole.position.set(-1.36, 0, 0.78);
  root.add(pole);
  const flag = buildFlag(0.9, 0.6);
  flag.mesh.position.set(-1.36, 2.1, 0.78);
  root.add(flag.mesh);
  return { root, wheels, mast, seats, sampleBox, flagTime: flag.time };
}

// ---------------------------------------------------------------------------
// 五星红旗 on a plane that ripples in an imaginary breeze (vertex shader).
// ---------------------------------------------------------------------------
export interface FlagObj {
  mesh: THREE.Mesh;
  /** Drives the ripple; advance it from the timeline. */
  time: { value: number };
}

export function buildFlag(w = 1.5, h = 1.0): FlagObj {
  const tex = canvasTexture(flagCanvas(900, 600));
  const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  const time = { value: 0 };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n float fx = uv.x; transformed.z += (sin(fx * 6.0 - uTime * 4.2) * 0.05 + sin(fx * 11.0 - uTime * 6.5 + uv.y * 2.0) * 0.02) * fx;',
      );
  };
  const g = new THREE.PlaneGeometry(w, h, 28, 18);
  g.translate(w / 2, 0, 0);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  return { mesh, time };
}

// ---------------------------------------------------------------------------
// Parachute: striped canopy + suspension lines, origin at the canopy apex, lines hang towards -Y.
// ---------------------------------------------------------------------------
export interface Parachute {
  root: THREE.Group;
  canopy: THREE.Group;
  /** 0 = packed, 1 = fully inflated. */
  set(inflate: number): void;
  /** Distance from apex to the payload attachment when inflated. */
  lineLen: number;
}

export function buildParachute(lineLen = 34): Parachute {
  const [c, ctx] = makeCanvas(1024, 256);
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#d8232a' : '#f4f1e8';
    ctx.fillRect((i * 1024) / 24, 0, 1024 / 24 + 1, 256);
  }
  const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(c), side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
  const root = new THREE.Group();
  const canopy = new THREE.Group();
  const RADIUS = 11;
  const THETA = Math.PI * 0.36;
  const FLAT = 0.62;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 48, 14, 0, Math.PI * 2, 0, THETA), mat);
  // apex at the group origin, rim at y = -RIM_Y with radius RIM_R
  dome.scale.y = FLAT;
  dome.position.y = -RADIUS * FLAT;
  canopy.add(dome);
  const RIM_Y = RADIUS * FLAT * (1 - Math.cos(THETA));
  const RIM_R = RADIUS * Math.sin(THETA);
  const N = 24;
  const linePos = new Float32Array(N * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xdedad0, transparent: true, opacity: 0.85 }));
  root.add(canopy, lines);
  const set = (inflate: number) => {
    const k = Math.max(0.001, inflate);
    const sy = 0.25 + 0.75 * k;
    canopy.scale.set(k, sy, k);
    canopy.visible = inflate > 0.01;
    lines.visible = canopy.visible;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      linePos[i * 6] = Math.cos(a) * RIM_R * k;
      linePos[i * 6 + 1] = -RIM_Y * sy;
      linePos[i * 6 + 2] = Math.sin(a) * RIM_R * k;
      linePos[i * 6 + 3] = 0;
      linePos[i * 6 + 4] = -lineLen * k;
      linePos[i * 6 + 5] = 0;
    }
    lineGeo.getAttribute('position').needsUpdate = true;
  };
  set(0);
  return { root, canopy, set, lineLen };
}
