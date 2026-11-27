import * as THREE from 'three';
import { materials, Plume, cyl, markShadows } from '../../art/geo';
import { buildTerrain, makeTerrain } from '../../art/terrain';
import { buildLander, type Lander } from '../../art/lander';
import { buildEarth, faceLongitude, Stars, type Earth } from '../../art/planet';
import { Particles, ringSpawn } from '../../art/particles';
import { buildAstronaut, buildFlag, buildRover, type Astronaut, type FlagObj, type Rover } from '../../art/props';
import { clamp, easeOutCubic, plateau, seg, shake, smootherstep, smoothstep } from '../../core/easing';
import type { Assets } from '../assets';
import { WORLD_UP, newPose, type Anchor, type CamPose, type SoundParams, type Stage, type StageCtx } from '../types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const SUN = new THREE.Vector3(0.4, 0.26, 0.88).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const EARTH_DIR = new THREE.Vector3(-0.35, 0.165, -0.92).normalize();
const EARTH_D = 2500;
const GRAVITY = 1.62;

/** Approach: comes in from +X, braking, and settles on the flat at the origin. */
const APPR_X = 170;
const APPR_Y = 230;
const approach = (s: number, touch: number) => ({
  x: APPR_X * (1 - smootherstep(0, touch * 0.86, s)),
  y: s >= touch ? 0 : APPR_Y * Math.pow(1 - s / touch, 1.5),
  tilt: 0.95 * (1 - smootherstep(0, touch * 0.72, s)),
});

/** Crew route on the surface: timed keys, optionally riding on the rover. */
interface Key {
  t: number;
  p?: [number, number, number];
  ride?: boolean;
  /** Facing, radians about Y (0 = +Z). Defaults to the direction of travel. */
  face?: number;
  /** 1: down the ladder backwards, -1: up the ladder. */
  climb?: 1 | -1;
  /** Kneeling. */
  k?: number;
  /** Raised arm. */
  wave?: number;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ka = new THREE.Vector3();
const kb = new THREE.Vector3();

function sampleKeys(keys: Key[], t: number, seat: THREE.Vector3, seatYaw: number, out: THREE.Vector3) {
  const at = (k: Key, v: THREE.Vector3) => (k.ride ? v.copy(seat) : v.fromArray(k.p!));
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const span = Math.max(1e-3, b.t - a.t);
  const u = clamp((t - a.t) / span);
  at(a, ka);
  at(b, kb);
  out.copy(ka).lerp(kb, u);
  const climb = b.climb ?? 0;
  const face = climb === 1 ? 0 : climb === -1 ? Math.PI : (b.face ?? (b.ride ? seatYaw : b.p && a.p ? Math.atan2(b.p[0] - a.p[0], b.p[2] - a.p[2]) : (a.face ?? 0)));
  const dist = ka.distanceTo(kb);
  return {
    face,
    climb,
    walk: dist > 0.02 ? clamp(dist / span / 1.15) : 0,
    sit: b.ride ? (a.ride ? 1 : u) : a.ride ? 1 - u : 0,
    k: lerp(a.k ?? 0, b.k ?? 0, u),
    wave: lerp(a.wave ?? 0, b.wave ?? 0, u),
  };
}

const A0: Key[] = [
  { t: 0, p: [0.35, 5.95, 0.5], face: 0 },
  { t: 9, p: [0.35, 5.95, 0.5], face: 0 },
  { t: 10, p: [0, 5.95, 2.25], face: 0 },
  { t: 10.6, p: [0, 5.95, 2.95], face: 0 },
  { t: 13.6, p: [0, 0, 2.95], climb: 1, face: 0 },
  { t: 14.2, p: [0.6, 0, 4.2], face: 0 },
  { t: 14.8, p: [0.6, 0, 4.2], face: -1.3 },
  { t: 18.2, p: [-3.2, 0, 4.0], face: -1.3 },
  { t: 18.8, ride: true },
  { t: 24.6, ride: true },
  { t: 25.1, p: [-2.1, 0, 7.2], face: 0.5 },
  { t: 25.5, p: [-1.4, 0, 6.9], face: 0.5 },
  { t: 25.9, p: [-1.4, 0, 6.9], face: 0.5, k: 1 },
  { t: 27.9, p: [-1.4, 0, 6.9], face: 0.5, k: 1 },
  { t: 28.3, p: [-1.4, 0, 6.9], face: 0, k: 0 },
  { t: 30.9, p: [0.5, 0, 3.8], face: 0 },
  { t: 31.2, p: [0.3, 0, 3.3], face: Math.PI },
  { t: 32.0, p: [0, 0, 2.95], face: Math.PI },
  { t: 35.0, p: [0, 5.95, 2.95], climb: -1, face: Math.PI },
  { t: 35.5, p: [0.35, 5.95, 1.2], face: Math.PI },
  { t: 36, p: [0.35, 5.95, 0.5], face: 0 },
];

const A1: Key[] = [
  { t: 0, p: [-0.3, 5.95, 0.9], face: 0 },
  { t: 11.4, p: [-0.3, 5.95, 0.9], face: 0 },
  { t: 12.4, p: [0, 5.95, 2.25], face: 0 },
  { t: 13, p: [0, 5.95, 2.95], face: 0 },
  { t: 16, p: [0, 0, 2.95], climb: 1, face: 0 },
  { t: 16.6, p: [0.9, 0, 4.2], face: 0 },
  { t: 17, p: [0.9, 0, 4.2], face: 1.0 },
  { t: 20, p: [3.9, 0, 6.0], face: 1.1, k: 0.5 },
  { t: 21.4, p: [3.9, 0, 6.0], face: 1.1, k: 0 },
  { t: 22.2, p: [3.9, 0, 6.0], face: 1.1 },
  { t: 22.8, p: [2.9, 0, 6.9], face: 1.0 },
  { t: 24.6, p: [2.9, 0, 6.9], face: 1.0, wave: 1 },
  { t: 25.2, p: [2.9, 0, 6.9], face: 0.4 },
  { t: 26.2, p: [3.3, 0, 8.2], face: 0.5 },
  { t: 26.8, p: [3.3, 0, 8.2], face: 0.5, k: 1 },
  { t: 28.2, p: [3.3, 0, 8.2], face: 0.5, k: 1 },
  { t: 28.6, p: [3.3, 0, 8.2], face: 0, k: 0 },
  { t: 30.4, p: [0.5, 0, 3.7], face: 0 },
  { t: 30.7, p: [0.4, 0, 3.3], face: Math.PI },
  { t: 31.2, p: [0, 0, 2.95], face: Math.PI },
  { t: 34.2, p: [0, 5.95, 2.95], climb: -1, face: Math.PI },
  { t: 34.8, p: [-0.2, 5.95, 1.4], face: Math.PI },
  { t: 35.4, p: [-0.3, 5.95, 0.9], face: 0 },
];

const ROVER_PATH = new THREE.CatmullRomCurve3(
  [[-5.2, 3.6], [-12, 7.5], [-15.5, 15.5], [-9.5, 21.5], [-0.5, 20], [4.5, 13], [-3.0, 6.6]].map(([x, z]) => V(x, 0, z)),
  false,
  'centripetal',
);
const FLAG_POS = V(4.6, 0, 7.0);

export class SurfaceStage implements Stage {
  readonly id = 'surface';
  readonly root = new THREE.Group();
  readonly near = 0.5;
  readonly far = 40000;
  readonly ambient = 1;
  private sun: THREE.DirectionalLight;
  private earth: Earth;
  private lander: Lander;
  private mainPlume = new Plume(C(1.0, 0.42, 0.14), 36, 5.5, 40, C(1.0, 0.72, 0.42), 2.0);
  private liftPlumes = [0, 1, 2, 3].map(() => new Plume(C(1.0, 0.5, 0.2), 17, 1.25, 24, C(1.0, 0.8, 0.55), 1.6));
  private landDust: Particles;
  private liftDust: Particles;
  private rover: Rover;
  private roverG = new THREE.Group();
  private crew: Astronaut[];
  private flagPole = new THREE.Group();
  private flag: FlagObj;
  private sample: THREE.Mesh;
  private nodes: Record<string, THREE.Object3D> = {};
  private list: Anchor[];
  private actId = 6;
  private aspect = 1.78;
  private evNow: Record<string, number> = {};
  private pose = newPose();
  private w = new THREE.Vector3();
  private w2 = new THREE.Vector3();
  private seat = new THREE.Vector3();

  constructor(assets: Assets, pixelRatio: number, rings = 110, segments = 240) {
    const q = assets.quality.particles;
    const sun = new THREE.DirectionalLight(0xfff2e2, 4.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 900;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.04;
    this.sun = sun;
    this.root.add(sun, sun.target, new THREE.HemisphereLight(0x2a2a33, 0x6b665f, 0.45));

    this.root.add(buildTerrain(makeTerrain(7), assets.regolith, rings, segments).mesh);

    this.earth = buildEarth(70, assets.earth);
    this.earth.group.position.copy(EARTH_DIR).multiplyScalar(EARTH_D);
    faceLongitude(this.earth.mesh, 108);
    this.earth.setSun(SUN);
    this.root.add(this.earth.group);
    const stars = new Stars(14000, pixelRatio);
    stars.setOpacity(0.5);
    this.root.add(stars);

    this.lander = buildLander();
    markShadows(this.lander.root);
    this.mainPlume.position.copy(this.lander.mainEngine);
    this.lander.root.add(this.mainPlume);
    this.lander.ascentEngines.forEach((e, i) => {
      this.liftPlumes[i].position.copy(e);
      this.lander.ascent.add(this.liftPlumes[i]);
    });
    this.root.add(this.lander.root);

    this.rover = buildRover();
    markShadows(this.rover.root);
    this.roverG.add(this.rover.root);
    this.root.add(this.roverG);

    this.crew = [0, 1].map(() => {
      const a = buildAstronaut();
      markShadows(a.root);
      a.root.userData.part = 'suit';
      this.root.add(a.root);
      return a;
    });

    this.flagPole.position.copy(FLAG_POS);
    this.flagPole.add(cyl(0.03, 0.035, 2.7, materials().metal, 8, 0));
    this.flag = buildFlag(1.5, 1.0);
    this.flag.mesh.position.y = 2.2;
    this.flagPole.add(this.flag.mesh);
    this.root.add(this.flagPole);
    this.sample = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.32), materials().offwhite);
    this.root.add(this.sample);

    const dust = (count: number, seed: number, r0: number, r1: number, speed: [number, number], up: [number, number]) =>
      new Particles({ count: Math.round(count * q), seed, spawn: ringSpawn(r0, r1, speed, up) });
    this.landDust = dust(420, 51, 2.6, 4.6, [14, 30], [1.5, 4]);
    this.liftDust = dust(520, 52, 3.4, 6.2, [24, 52], [2, 6]);
    this.root.add(this.landDust, this.liftDust);

    const mk = (id: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.nodes[id] = o;
      return o;
    };
    const A = (id: string, label: string, target: THREE.Object3D, part?: string) => ({ id, label, target, local: new THREE.Vector3(), show: false, part }) as Anchor;
    this.list = [
      A('ascent', '登月舱', mk('ascent', this.lander.root, -1.2, 8.6, 1.56), 'ascentStage'),
      A('descent', '推进舱', mk('descent', this.lander.root, -1.4, 3.6, 2.38), 'descentStage'),
      A('legs', '着陆腿', mk('legs', this.lander.root, 3.0, 1.5, 3.0), 'legs'),
      A('suit', '望宇登月服', mk('suit', this.crew[0].root, 0, 1.5, 0), 'suit'),
      A('rover', '探索载人月球车', mk('rover', this.rover.root, 0.5, 2.3, 0), 'rover'),
      A('flag', '五星红旗', mk('flag', this.flagPole, 0.2, 3.3, 0)),
      A('earth', '地球', mk('earth', this.root, 0, 1, 0)),
    ];
  }

  // ---- camera -------------------------------------------------------------------------------
  camera(tl: number, out: CamPose): CamPose {
    out.up.copy(WORLD_UP);
    if (this.actId === 5) return this.camLanding(tl, out);
    if (this.actId === 6) {
      if (tl < 7.8) return this.dolly(out, [17, 1.3, 23], [12.5, 3.6, 19.5], [0, 8, 0], [0, 7.2, 0], 40, seg(tl, 0, 7.8));
      if (tl < 15.2) return this.dolly(out, [15, 9, 23], [12.5, 6.8, 19.5], [0, 6.2, 1.6], [0, 4.6, 2.4], 40, seg(tl, 7.8, 15.2));
      if (tl < 19) return this.dolly(out, [-17, 4.5, 15], [-14, 3.6, 13], [-4.5, 2.2, 3.5], [-4.5, 2.2, 3.5], 40, seg(tl, 15.2, 19));
      if (tl < 25) return this.dolly(out, [25, 8.5, 37], [21, 7, 33], [-2, 1.5, 11], [-2, 1.5, 11], 42, seg(tl, 19, 25));
      if (tl < 30.8) return this.dolly(out, [-9.5, 2.6, 14.5], [-8, 3.2, 13], [-0.5, 1.4, 5.6], [-0.5, 1.4, 5.6], 38, seg(tl, 25, 30.8));
      return this.dolly(out, [9.5, 5.5, 19], [8, 4.6, 17], [0, 4.0, 2.4], [0, 4.0, 2.4], 40, seg(tl, 30.8, 36));
    }
    const h = this.lift(tl);
    if (tl < 3.4) return this.dolly(out, [14, 1.5, 15.5], [12.5, 1.8, 14], [0, 3.4, 0], [0, 3.4, 0], 40, seg(tl, 0, 3.4));
    if (tl < 8.6) return this.dolly(out, [24, 2.6, 31], [26, 6.5, 33], [0, 6, 0], [0, 6 + Math.min(h * 0.85, 62), 0], 42, seg(tl, 3.4, 8.6));
    return this.dolly(out, [15, 5.5, 18], [18.5, 6.5, 14.5], [0, 3.0, 0], [0, 3.0, 0], 40, seg(tl, 8.6, 12.5));
  }

  private dolly(out: CamPose, p0: number[], p1: number[], l0: number[], l1: number[], fov: number, k: number): CamPose {
    out.pos.fromArray(p0).lerp(this.w.fromArray(p1), k);
    out.look.fromArray(l0).lerp(this.w2.fromArray(l1), k);
    out.fov = fov;
    return out;
  }

  private camLanding(tl: number, out: CamPose): CamPose {
    const s = tl - 8;
    const a = approach(s, this.evNow.touch - 8);
    // flying alongside the lander, level with it: ground below the horizon, black sky and Earth above
    if (s < 5.5) {
      const k = s / 5.5;
      out.pos.set(a.x + 70 - 10 * k, a.y + 16 - 3 * k, 112 - 14 * k);
      out.look.set(a.x, a.y + 16 - 3 * k, 0);
      out.fov = 28;
      return out;
    }
    if (s < 11.5) {
      const k = (s - 5.5) / 6;
      out.pos.set(a.x + 44 - 8 * k, a.y + 9 - 2 * k, 64 - 10 * k);
      out.look.set(a.x, a.y + 7 - 2 * k, 0);
      out.fov = 36;
      return out;
    }
    if (s < 17) return this.dolly(out, [18, 2.0, 24], [16, 2.6, 21.5], [1.5, 4.6, 0], [1.5, 4.6, 0], 38, (s - 11.5) / 5.5);
    return this.dolly(out, [40, 13, 54], [31, 9.5, 43], [0, 4.2, 0], [0, 4.2, 0], 40, (s - 17) / 5);
  }

  /** Height of the ascent stage above its seat on the descent stage (act 7). */
  private lift(tl: number): number {
    const s = tl - (this.evNow.liftoff ?? 4.2);
    return s <= 0 ? 0 : 1.3 * s * s;
  }

  pip(tl: number, out: CamPose): CamPose | null {
    out.up.copy(WORLD_UP);
    if (this.actId === 5) {
      if (tl < 21.6 || tl > 25) return null;
      const k = seg(tl, 21.6, 25);
      out.pos.set(8.8 - 0.8 * k, 1.05 + 0.1 * k, 8.4 - 0.7 * k);
      out.look.set(3.46, 0.4, 3.46);
      out.fov = 30;
      return out;
    }
    if (this.actId !== 7 || tl < 2.8 || tl > 6.2) return null;
    const k = seg(tl, 2.8, 6.2);
    out.pos.set(10.5 - 1.5 * k, 7.2 + 1.2 * k, 10.5 - 1.5 * k);
    out.look.set(0, 5.6 + Math.min(this.lift(tl), 3) * 0.7, 0);
    out.fov = 32;
    return out;
  }

  // ---- state --------------------------------------------------------------------------------
  update(ctx: StageCtx): void {
    const { act, tl } = ctx;
    const id = act.id;
    const ev = act.ev;
    this.actId = id;
    this.evNow = ev;
    const flick = 0.86 + 0.14 * Math.sin(tl * 53) * Math.sin(tl * 19.3 + 1.1);

    // ---- lander ------------------------------------------------------------------------------
    let alt = 0;
    let engine = 0;
    let lx = 0;
    if (id === 5) {
      const s = tl - 8;
      const a = approach(s, ev.touch - 8);
      lx = a.x;
      alt = a.y + (s > ev.touch - 8 ? -0.06 * shake(s - (ev.touch - 8), 16, 3.5) : 0);
      this.lander.root.rotation.z = a.tilt;
      engine = plateau(tl, 5.9, ev.touch + 0.15, 0.8, 0.25) * (0.35 + 0.65 * plateau(tl, 5.9, 15.2, 0.8, 2.2));
    } else {
      this.lander.root.rotation.z = 0;
    }
    this.lander.root.position.set(lx, alt, 0);
    this.lander.ascent.position.y = 5.8 + (id === 7 ? this.lift(tl) : 0);
    this.lander.root.updateMatrixWorld(true);
    const len = clamp((alt - 0.35) / 36, 0.07, 1);
    this.mainPlume.set(engine * 0.62 * flick, tl, len * (0.8 + 0.2 * flick), 1);
    const fire = id === 7 ? plateau(tl, ev.ignite, 99, 0.3, 0.2) : 0;
    this.liftPlumes.forEach((p) => p.set(fire * 0.8 * flick, tl, 0.3 + 0.7 * smoothstep(0.5, 9, this.lift(tl)), 1));

    // ---- dust: no air, so every grain flies a ballistic arc --------------------------------------
    const near = clamp(1 - alt / 26, 0, 1);
    this.landDust.position.set(lx, 0.05, 0);
    this.landDust.emit({
      time: tl - 8,
      life: 2.8,
      size0: 0.45,
      size1: 2.2,
      stretch: 1.7,
      accel: V(0, -GRAVITY, 0),
      fadeIn: 0.03,
      fadePow: 1.5,
      soft: 0.7,
      noise: 0.5,
      opacity: id === 5 ? Math.pow(near, 1.2) * plateau(tl, 8.2, ev.touch + 0.15, 1.2, 2.4) : 0,
      colorA: C(0.62, 0.6, 0.57),
      colorB: C(0.42, 0.41, 0.4),
    });
    this.liftDust.emit({
      time: tl - 3.5,
      life: 3.6,
      size0: 0.8,
      size1: 4,
      stretch: 1.7,
      accel: V(0, -GRAVITY, 0),
      fadeIn: 0.03,
      fadePow: 1.4,
      soft: 0.7,
      noise: 0.5,
      opacity: id === 7 ? plateau(tl, 3.5, 6.5, 0.5, 4.5) : 0,
      colorA: C(0.62, 0.6, 0.57),
      colorB: C(0.42, 0.41, 0.4),
    });

    // ---- rover -----------------------------------------------------------------------------------
    const deploy = easeOutCubic(seg(tl, id === 7 ? 99 : 15, 16.8));
    let drive = 0;
    if (id === 6) drive = seg(tl, 19, 24.6);
    const rp = ROVER_PATH.getPointAt(drive, this.w);
    // stowed against the left side of the descent stage until it folds down to the ground
    this.roverG.position.set(lerp(-4.1, rp.x, deploy), lerp(1.6, 0, deploy), lerp(0, rp.z, deploy));
    const tan = ROVER_PATH.getTangentAt(drive, this.w2);
    this.roverG.rotation.y = Math.atan2(tan.x, tan.z);
    this.roverG.updateMatrixWorld(true);
    this.rover.wheels.forEach((w) => (w.rotation.z = -(drive * ROVER_PATH.getLength()) / 0.4));
    this.rover.flagTime.value = 1.3;
    this.seat.copy(this.rover.seats[1]).applyMatrix4(this.rover.root.matrixWorld);

    // ---- hatch, flag, sample -----------------------------------------------------------------------
    const open = id === 6 ? smoothstep(ev.hatch, ev.hatch + 1.1, tl) * (1 - smoothstep(35.2, 35.9, tl)) : 0;
    this.lander.hatchHinge.rotation.y = -1.95 * open;
    const plant = id === 6 ? smoothstep(19.6, 21.5, tl) : 1;
    this.flagPole.visible = id === 7 || (id === 6 && tl >= 18.6);
    // turned so the cameras on the way in and out both see the sunlit face
    this.flagPole.rotation.set(1.25 * (1 - plant), -0.31, 0);
    this.flag.time.value = 2.0;
    const boxK = id === 6 ? seg(tl, 27.6, 34.4) : 2;
    this.sample.visible = boxK < 1;

    // ---- crew ------------------------------------------------------------------------------------------
    const onMoon = id === 6;
    this.crew.forEach((a, i) => {
      a.root.visible = id !== 5;
      if (id === 5) return;
      const s = onMoon ? sampleKeys(i === 0 ? A0 : A1, tl, this.seat, this.roverG.rotation.y, this.w) : { face: 0, walk: 0, climb: 0, sit: 0, k: 0, wave: 0 };
      if (onMoon) this.w.y -= 0.46 * s.k;
      else this.w.fromArray(i === 0 ? [0.35, 0.15, 0.5] : [-0.3, 0.15, 0.9]).applyMatrix4(this.lander.ascent.matrixWorld);
      if (i === 0 && this.sample.visible) this.sample.position.copy(this.w).add(this.w2.set(Math.sin(s.face) * 0.1, 0.95, Math.cos(s.face) * 0.36));
      a.root.position.copy(this.w);
      a.root.rotation.set(0, s.face, 0);
      const climb = Math.abs(s.climb);
      const armL: [number, number] = [0.12 - 2.6 * climb - 0.9 * s.sit - 0.7 * s.k, 0.14 + 0.2 * climb + 0.2 * s.sit];
      const armR: [number, number] = [0.12 - 2.6 * climb - 0.9 * s.sit - 1.0 * s.k - 2.75 * s.wave, 0.14 + 0.2 * climb + 0.2 * s.sit + 0.75 * s.wave];
      a.pose({ walk: Math.max(s.walk, 0.45 * climb), phase: tl * 6.4 + i * 2.1, sit: Math.max(s.sit, 1.45 * s.k), lean: 0.38 * s.k, armL, armR });
    });

    // ---- light and backdrop --------------------------------------------------------------------------
    this.aspect = ctx.aspect;
    this.camera(tl, this.pose);
    const focus = id === 6 && tl > 18.5 && tl < 25 ? this.roverG.position : this.lander.root.position;
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(SUN, 420);
    this.sun.target.updateMatrixWorld();
    // a portrait screen shows a narrow slice of the sky: swing the Earth towards where the cameras look, so it stays in frame
    this.w.copy(EARTH_DIR).multiplyScalar(EARTH_D).applyAxisAngle(UP, THREE.MathUtils.degToRad(14 * clamp((1.5 - this.aspect) / 0.8, 0, 1)));
    this.earth.group.position.copy(this.w);
    this.earth.update(tl, this.pose.pos);
    (this.nodes.earth as THREE.Object3D).position.copy(this.earth.group.position).add(V(0, 92, 0));

    // ---- labels ----------------------------------------------------------------------------------------
    const set = (key: string, show: boolean, label?: string) => {
      const a = this.list.find((x) => x.id === key)!;
      a.show = show;
      if (label !== undefined) a.label = label;
    };
    const close = id === 5 ? tl > 13.5 : true;
    set('ascent', close && !(id === 7 && tl > 8.6), id === 7 ? '登月舱' : '登月舱 · 航天员座舱');
    set('descent', close && !(id === 6 && tl > 30.8), id === 7 ? '推进舱 · 留在月面' : '推进舱');
    set('legs', close && !(id === 6 && tl > 19));
    set('suit', onMoon && tl > 11.2 && tl < 30.8);
    set('rover', id === 6 && tl > 15.6 && tl < 30.8);
    set('flag', id === 6 && tl > 21.4);
    set('earth', id === 5 ? tl > 24 : id === 6 ? tl < 7.8 || tl > 30.8 : false);
  }

  anchors(): Anchor[] {
    return this.list;
  }

  pickRoots(): THREE.Object3D[] {
    return [this.lander.root, this.rover.root, ...this.crew.map((a) => a.root)];
  }

  sound(tl: number): SoundParams {
    const ev = this.evNow;
    const thrust =
      this.actId === 5 ? plateau(tl, 5.9, ev.touch + 0.15, 0.8, 0.3) * (0.45 + 0.55 * plateau(tl, 5.9, 15.2, 0.8, 2.2))
      : this.actId === 7 ? 0.8 * plateau(tl, ev.ignite ?? 3.4, 99, 0.3, 0.2)
      : 0;
    return { thrust, wind: 0 };
  }

  bloom() {
    return { strength: 0.4, threshold: 1.3 };
  }
}
