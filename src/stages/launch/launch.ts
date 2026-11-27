import * as THREE from 'three';
import { Plume, markShadows } from '../../art/geo';
import { Particles, discSpawn } from '../../art/particles';
import { buildRocket, type Rocket } from '../../art/cz10';
import { buildLander } from '../../art/lander';
import { buildShip } from '../../art/ship';
import { clamp, easeOutCubic, plateau, seg, smoothstep } from '../../core/easing';
import type { ActDef } from '../../core/timeline';
import type { Assets } from '../assets';
import { WORLD_UP, newPose, type Anchor, type CamPose, type SoundParams, type Stage, type StageCtx } from '../types';
import { buildLaunchEnv, type LaunchEnv } from './env';
import { buildPad, DUCT_X, GROUND_Y, ROCKET_Y, TOWER_X, type Pad } from './pad';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** Metres climbed since liftoff, shaped so the first seconds read as slow motion. */
const altitude = (s: number) => (s <= 0 ? 0 : s < 3.2 ? 2.4 * s * s : 24.6 + 70 * (s - 3.2) * (s - 3.2) * (1 + 0.05 * (s - 3.2)));

export class LaunchStage implements Stage {
  readonly id = 'launch';
  readonly root = new THREE.Group();
  readonly near = 1.0;
  readonly far = 90000;
  private env: LaunchEnv;
  private pad: Pad;
  private frame = new THREE.Group();
  private rockets: Record<number, Rocket>;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private flameLight = new THREE.PointLight(0xff8a3a, 0, 0, 1.6);
  private corePlume = new Plume(C(1.0, 0.5, 0.12), 64, 4.8, 40, C(1.0, 0.8, 0.5));
  private boostPlumes = [new Plume(C(1.0, 0.5, 0.12), 56, 3.6, 40, C(1.0, 0.8, 0.5)), new Plume(C(1.0, 0.5, 0.12), 56, 3.6, 40, C(1.0, 0.8, 0.5))];
  private vacPlume = new Plume(C(1.0, 0.5, 0.16), 190, 26, 40, C(1.0, 0.68, 0.38));
  /** Flame jets shooting sideways out of the exhaust ducts at ignition. */
  private ductPlumes = [new Plume(C(1.0, 0.55, 0.15), 54, 5.5), new Plume(C(1.0, 0.55, 0.15), 54, 5.5)];
  private upperPlume = new Plume(C(0.6, 0.75, 1.0), 110, 13);
  private sparks: Particles;
  private smokeL: Particles;
  private smokeR: Particles;
  private puffs: Particles;
  // both pad cameras sit a few units above the ground and look up
  camFloor = GROUND_Y + 2.5;
  private list: Anchor[];
  private nodes: Record<string, THREE.Object3D> = {};
  private pose = newPose();
  private act: ActDef = null as unknown as ActDef;
  private w = new THREE.Vector3();

  constructor(assets: Assets, pixelRatio: number) {
    const q = assets.quality.particles;
    this.env = buildLaunchEnv(pixelRatio);
    this.root.add(this.env.group);
    this.pad = buildPad();
    this.root.add(this.pad.group);

    const sun = new THREE.DirectionalLight(0xffc79a, 3.3);
    sun.position.copy(this.env.sunDir).multiplyScalar(1600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -190;
    sc.right = 190;
    sc.top = 330;
    sc.bottom = -330;
    sc.near = 200;
    sc.far = 3400;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
    this.sun = sun;
    this.hemi = new THREE.HemisphereLight(0x7f97d6, 0x2a2f36, 0.8);
    this.root.add(sun, sun.target, this.hemi, this.flameLight);

    this.frame.position.y = ROCKET_Y;
    this.root.add(this.frame);
    const lander = buildLander();
    markShadows(lander.root);
    const ship = buildShip();
    markShadows(ship.root);
    ship.setTower(true);
    ship.setSolar(0.02);
    this.rockets = { 1: buildRocket('lander', lander.root), 3: buildRocket('ship', ship.root) };
    for (const r of Object.values(this.rockets)) {
      markShadows(r.root);
      r.root.visible = false;
      this.frame.add(r.root);
    }
    this.corePlume.position.y = -3.4;
    this.vacPlume.position.y = -3.4;
    for (const [i, p] of this.boostPlumes.entries()) p.position.set(i === 0 ? 5 : -5, -3.3, 0);

    // exhaust flame texture on top of the solid plume
    this.sparks = new Particles({ count: Math.round(220 * q), seed: 5, additive: true, spawn: discSpawn(3.0, [70, 125], 0.3) });
    this.sparks.position.y = -3.4;
    // pad smoke pouring out of both exhaust ducts
    const duct = (side: number) => (_i: number, rnd: () => number, out: { offset: THREE.Vector3; vel: THREE.Vector3 }) => {
      out.offset.set(side * (DUCT_X - 10 + rnd() * 16), GROUND_Y + 1 + rnd() * 4, (rnd() - 0.5) * 16);
      out.vel.set(side * (22 + rnd() * 40), 3 + rnd() * 11, (rnd() - 0.5) * 22);
    };
    this.smokeL = new Particles({ count: Math.round(260 * q), seed: 11, spawn: duct(1) });
    this.smokeR = new Particles({ count: Math.round(260 * q), seed: 12, spawn: duct(-1) });
    // cold-gas puffs at separation
    this.puffs = new Particles({
      count: Math.round(90 * q),
      seed: 21,
      additive: true,
      spawn: (_i, rnd, out) => {
        const a = rnd() * Math.PI * 2;
        out.offset.set((rnd() - 0.5) * 3, (rnd() - 0.5) * 8, (rnd() - 0.5) * 3);
        out.vel.set(Math.cos(a) * (6 + rnd() * 14), (rnd() - 0.5) * 10, Math.sin(a) * (6 + rnd() * 14));
      },
    });
    this.puffs.position.set(0, 0, 0);
    this.frame.add(this.corePlume, this.boostPlumes[0], this.boostPlumes[1], this.vacPlume, this.upperPlume, this.flameLight, this.puffs);
    for (const [i, p] of this.ductPlumes.entries()) {
      p.position.set(i === 0 ? DUCT_X : -DUCT_X, GROUND_Y + 3.5, 0);
      p.rotation.z = i === 0 ? Math.PI / 2 : -Math.PI / 2;
      this.root.add(p);
    }
    this.root.add(this.smokeL, this.smokeR);

    const mk = (id: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.nodes[id] = o;
      return o;
    };
    const A = (id: string, label: string, target: THREE.Object3D, part?: string) => ({ id, label, target, local: new THREE.Vector3(), show: false, part }) as Anchor;
    this.list = [
      A('rocket', '长征十号', mk('rocket', this.frame, 9, 40, 0), 'rocket'),
      A('tower', '脐带塔', mk('tower', this.pad.group, TOWER_X, 104, 0)),
      A('lander', '揽月', mk('lander', this.rockets[1].payload, 4.2, 3.2, 0), 'lander'),
      A('ship', '梦舟', mk('ship', this.frame, 4.6, 70.5, 0), 'ship'),
      A('escape', '逃逸塔', mk('escape', this.frame, 1.2, 90, 0), 'escapeTower'),
    ];
  }

  // ---- flight state as pure functions of act-local time -------------------------------------------
  private liftoff = (act: ActDef) => act.ev.liftoff;

  private state(tl: number) {
    const L = this.liftoff(this.act);
    const s = tl - L;
    const alt = altitude(s);
    const a = smoothstep(1200, 9000, alt);
    const tilt = 0.66 * smoothstep(800, 14000, alt);
    const on = tl >= this.act.ev.ignite;
    return { s, alt, a, tilt, on };
  }

  camera(tl: number, out: CamPose): CamPose {
    const ship = this.act.id === 3;
    const st = this.state(tl);
    out.up.copy(WORLD_UP);
    if (tl < 4.6) {
      // S1: wide establishing shot from the seaward side, sun on the hull
      const k = seg(tl, 0, 4.6);
      out.pos.set(74 - 14 * k, GROUND_Y + 4, 168 - 26 * k);
      out.look.set(-8, 56, 0);
      out.fov = 46;
      return out;
    }
    if (tl < 9.5) {
      // S2: low angle by the mount for ignition and lift-off. Close and wide, so the tip of the fairing stays in frame
      // while the flood-light masts around the pad (radius 62) fall outside the view.
      const k = seg(tl, 4.6, 9.5);
      out.pos.set(34 - 4 * k, GROUND_Y + 5, 61 - 7 * k);
      out.look.set(0, ROCKET_Y + 33 + st.alt * 0.95, 0);
      out.fov = 56;
      return out;
    }
    if (tl < (ship ? 14.5 : 17)) {
      if (ship) {
        // S3b: close on the escape tower as the sky darkens
        const k = seg(tl, 9.5, 14.5);
        this.rel(out, V(34 - 10 * k, 68 + 10 * k, 40 - 10 * k), V(0, 84 + 6 * k, 0), 36);
      } else {
        // S3: long lens from far down the coast; the tracker swings up as the rocket recedes
        const k = seg(tl, 9.5, 17);
        out.pos.set(3000, 40, 1400);
        this.frame.getWorldPosition(this.w);
        out.look.copy(this.w).add(V(0, 46, 0));
        out.fov = 7.5 - 4 * k;
      }
      return out;
    }
    const k = easeOutCubic(seg(tl, ship ? 14.5 : 17, ship ? 26 : 23));
    this.rel(out, V(124 - 40 * k, -34 + 40 * k, 166 - 52 * k), V(0, 16 + 12 * k, 0), 42);
    if (!ship && tl >= 23) {
      const j = easeOutCubic(seg(tl, 23, 32));
      this.rel(out, V(84 - 58 * j, 8 + 44 * j, 112 - 78 * j), V(0, 42 + 32 * j, 0), 40);
    }
    return out;
  }

  /** Pose given in the rocket's (tilted) frame; screen-up follows the vehicle so it stays vertical. */
  private rel(out: CamPose, pos: THREE.Vector3, look: THREE.Vector3, fov: number): void {
    out.pos.copy(pos).applyMatrix4(this.frame.matrixWorld);
    out.look.copy(look).applyMatrix4(this.frame.matrixWorld);
    out.up.set(0, 1, 0).transformDirection(this.frame.matrixWorld);
    out.fov = fov;
  }

  update(ctx: StageCtx): void {
    const { act, tl } = ctx;
    this.act = act;
    const ev = act.ev;
    const rocket = this.rockets[act.id as 1 | 3];
    for (const r of Object.values(this.rockets)) r.root.visible = r === rocket;
    const st = this.state(tl);

    this.frame.position.set(0, ROCKET_Y + st.alt, 0);
    this.frame.rotation.set(st.tilt, 0, 0);
    this.frame.updateMatrixWorld(true);

    // service arms swing clear at ignition
    const armK = smoothstep(ev.ignite, ev.ignite + 2.2, tl);
    this.pad.arms.forEach((a, i) => (a.rotation.y = -(0.95 + i * 0.12) * armK));

    // ---- exhaust -------------------------------------------------------------------------
    const sepC = act.id === 1 && tl >= ev.stageSep;
    const thrust = plateau(tl, ev.ignite + 0.5, sepC ? ev.stageSep + 0.4 : 999, 1.6, 0.4);
    const boostOn = plateau(tl, ev.ignite + 0.5, ev.boostSep + 0.5, 1.6, 0.35);
    const flick = 0.82 + 0.18 * Math.sin(tl * 61) * Math.sin(tl * 23.7 + 1.3);
    const lowK = 1 - st.a * 0.75;
    this.corePlume.set(thrust * flick * (0.4 + 0.6 * lowK) * 1.3, tl, 0.55 + 0.45 * lowK + (1 - flick) * 0.5, 1 + st.a * 0.3);
    this.boostPlumes.forEach((p) => p.set(boostOn * flick * lowK * 1.0, tl, 0.5 + 0.5 * lowK, 1 + st.a * 0.3));
    this.vacPlume.set(st.a * thrust * 0.3 * flick, tl, 0.7 + 0.3 * flick, 1);
    const duct = plateau(tl, ev.ignite + 0.5, this.liftoff(act) + 5.5, 0.6, 2.6);
    for (const p of this.ductPlumes) p.set(duct * flick * 1.3, tl, 0.7 + 0.3 * flick, 1);
    this.sparks.position.y = -3.4;
    this.sparks.emit({
      time: tl - ev.ignite,
      life: 0.42,
      size0: 7.5,
      size1: 15,
      fadeIn: 0.05,
      fadePow: 1.8,
      soft: 0.55,
      noise: 0.25,
      opacity: thrust,
      intensity: 0.6 * flick,
      flicker: 0.5,
      colorA: C(2.0, 1.25, 0.45),
      colorB: C(1.5, 0.32, 0.05),
    });
    const upperOn = act.id === 1 ? plateau(tl, ev.stageSep + 0.5, 999, 0.5, 0.4) : 0;
    this.upperPlume.position.y = 36.5 - 2.9;
    this.upperPlume.set(upperOn * 0.9 * flick, tl, 0.75 + 0.25 * flick, 1);
    this.flameLight.position.y = -14;
    this.flameLight.intensity = (thrust * 1500 + upperOn * 260) * flick;

    // ---- separation choreography (parts fall back relative to the accelerating rocket) -------
    const back = (t0: number) => Math.max(0, tl - t0);
    rocket.boosters.forEach((b, i) => {
      const s = back(ev.boostSep);
      const side = i === 0 ? 1 : -1;
      b.position.x = side * (5 + 30 * (1 - Math.exp(-s * 0.55)));
      b.position.y = -14 * s * s;
      b.rotation.z = side * -1.5 * (1 - Math.exp(-s * 0.7));
      b.rotation.x = 0.25 * Math.sin(s * 1.3);
    });
    {
      const s = act.id === 1 ? back(ev.stageSep) : 0;
      rocket.core1.position.y = -11 * s * s;
      rocket.core1.rotation.z = 0.18 * (1 - Math.exp(-s)) * Math.sin(s * 0.9);
    }
    if (rocket.fairing) {
      const s = back(ev.fairing);
      rocket.fairing.forEach((h, i) => {
        const side = i === 0 ? 1 : -1;
        h.rotation.z = side * -2.0 * easeOutCubic(clamp(s / 2.2));
        h.position.x = side * 9 * s * s * 0.5;
        h.position.y = -4 * s * s;
      });
    }
    this.puffs.emit({ time: tl - ev.boostSep - 0.05, life: 0.7, once: true, size0: 4, size1: 11, fadeIn: 0.12, fadePow: 1.3, soft: 0.7, opacity: 0.5, intensity: 0.9, colorA: C(0.9, 0.95, 1.0), colorB: C(0.5, 0.6, 0.8) });

    // ---- pad smoke ----------------------------------------------------------------------
    const smokeOn = plateau(tl, ev.ignite, act.id === 1 ? 24 : 22, 2.4, 5);
    for (const s of [this.smokeL, this.smokeR]) {
      s.emit({
        time: tl - ev.ignite,
        life: 8,
        size0: 13,
        size1: 62,
        drag: 0.2,
        accel: V(0, 1.7, 0),
        wobble: [7, 0.5],
        fadeIn: 0.1,
        fadePow: 1.1,
        soft: 0.75,
        noise: 0.62,
        opacity: 0.5 * smokeOn,
        colorA: C(0.86, 0.84, 0.82),
        colorB: C(0.52, 0.53, 0.56),
      });
    }

    // ---- environment and lighting ----------------------------------------------------------
    this.camera(tl, this.pose);
    this.env.setAltitude(st.alt, st.a, this.pose.pos);
    this.env.setTime(tl);
    this.sun.color.setRGB(1.0, 0.78 - 0.1 * st.a, 0.6 + 0.38 * st.a);
    this.sun.intensity = 3.3 + 2.5 * st.a;
    this.hemi.intensity = 0.8 * (1 - st.a) + 0.06;
    this.sun.target.position.set(0, GROUND_Y + 30, 0);
    this.sun.target.updateMatrixWorld();

    // ---- labels and hotspots ----------------------------------------------------------------
    const set = (id: string, show: boolean, label?: string) => {
      const a = this.list.find((x) => x.id === id)!;
      a.show = show;
      if (label !== undefined) a.label = label;
    };
    const ship = act.id === 3;
    // on the long-lens shot the distant rocket would be upstaged by its own label
    set('rocket', ship ? tl < 14.5 : tl < 13 || tl > 17, ship ? '长征十号 · 梦舟' : '长征十号 · 揽月');
    set('tower', tl < 9.5);
    set('lander', !ship && tl >= ev.fairing + 0.6, '揽月（示意造型）');
    set('ship', ship && tl >= 5.2 && tl < 26, '梦舟 · 3 名航天员');
    set('escape', ship && tl >= 5.2, '逃逸塔');
  }

  anchors(): Anchor[] {
    return this.list;
  }

  pickRoots(): THREE.Object3D[] {
    return [this.rockets[1].root, this.rockets[3].root];
  }

  /** Ignition close-up for the slow-motion window: the cluster of nozzles lighting up above the mount. */
  pip(tl: number, out: CamPose): CamPose | null {
    if (tl < 4.3 || tl > 7.8) return null;
    const k = seg(tl, 4.3, 7.8);
    out.pos.set(19 - 4 * k, GROUND_Y + 13 - 1.5 * k, 23 - 4 * k);
    out.look.set(0, ROCKET_Y - 2.2 + this.state(tl).alt * 0.5, 0);
    out.fov = 34;
    out.up.copy(WORLD_UP);
    return out;
  }

  sound(tl: number): SoundParams {
    const st = this.state(tl);
    const thrust = plateau(tl, this.act.ev.ignite + 0.4, 999, 1.4, 0.3);
    return { thrust, wind: 0.35 * plateau(tl, 9, 24) * (1 - 0.6 * st.a) };
  }

  bloom() {
    return { strength: 0.24, threshold: 1.35 };
  }
}
