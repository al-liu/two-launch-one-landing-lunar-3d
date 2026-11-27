import * as THREE from 'three';
import { buildEarth, SunGlow, faceLongitude, Stars, type Earth } from '../art/planet';
import { canvasTexture, glowCanvas } from '../art/textures';
import { DEG, easeInOutSine, plateau, seg, smootherstep, smoothstep } from '../core/easing';
import type { Assets } from './assets';
import { CamTrack } from './camtrack';
import { RouteLine } from './route';
import { WORLD_UP, newPose, type Anchor, type CamPose, type SoundParams, type Stage, type StageCtx } from './types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const RE = 10;
const RM = (RE * 3474.8) / 12742; // true Earth/Moon size ratio
const EX = -38;
const MX = 38;
const RING = 3.9;
const ENTRY = 125 * DEG; // where the transfer arc is captured into lunar orbit
const DOCK = 205 * DEG; // where the stack separates before heading home

const ringPoint = (a: number, out: THREE.Vector3) => out.set(MX + RING * Math.cos(a), RING * Math.sin(a), 0);

/** Earth → Moon transfer arc. `lift` separates the crewed arc from the cargo arc. */
const outbound = (lift: number, z: number) =>
  new THREE.CatmullRomCurve3([
    V(EX + 10.8, 3.2 + lift * 0.1, 0),
    V(EX + 19, 10.5 + lift * 0.5, z * 0.3),
    V(-6, 13.2 + lift, z),
    V(16, 10.2 + lift, z * 0.7),
    V(MX - 8.5, 5.4 + lift * 0.3, z * 0.2),
    ringPoint(ENTRY, new THREE.Vector3()),
    ringPoint(ENTRY - 0.14, new THREE.Vector3()),
  ]);

const HOME = new THREE.CatmullRomCurve3([
  ringPoint(DOCK, new THREE.Vector3()),
  V(MX - 9.5, -4.6, 1.2),
  V(12, -8.6, 2.4),
  V(-8, -9.8, 1.4),
  V(EX + 19, -6.4, 0.2),
  V(EX + 10.6, -2.6, 0),
]);

function marker(color: THREE.Color): THREE.Group {
  const tex = canvasTexture(glowCanvas(128, '#ffffff', 2.4));
  const g = new THREE.Group();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: color.clone().multiplyScalar(1.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.setScalar(2.6);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.2, 2.1, 1.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  core.scale.setScalar(0.6);
  g.add(halo, core);
  return g;
}

export class EarthMoonStage implements Stage {
  readonly id = 'earthmoon';
  readonly root = new THREE.Group();
  readonly near = 0.05;
  readonly far = 1200;
  private earth: Earth;
  private ringMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private stars: Stars;
  private sun = new SunGlow();
  private out1: RouteLine;
  private out2: RouteLine;
  private home: RouteLine;
  private landerMk = marker(new THREE.Color(1.0, 0.68, 0.22));
  private shipMk = marker(new THREE.Color(1.0, 0.2, 0.14));
  private ascentMk = marker(new THREE.Color(0.85, 0.6, 0.25));
  private node = { earth: new THREE.Object3D(), moon: new THREE.Object3D(), dist: new THREE.Object3D() };
  private tracks: Record<number, CamTrack>;
  private list: Anchor[];
  private pose = newPose();
  private p = new THREE.Vector3();
  private actId = 0;

  constructor(assets: Assets, pixelRatio: number) {
    // sun over the viewer's shoulder: Earth and Moon both show as bright gibbous discs
    const sunDir = new THREE.Vector3(-0.55, 0.38, 0.74).normalize();
    const sunLight = new THREE.DirectionalLight(0xfff3e0, 3.4);
    sunLight.position.copy(sunDir).multiplyScalar(100);
    const fill = new THREE.DirectionalLight(0x8fb4ff, 0.35);
    fill.position.set(6, 3, 10);
    this.root.add(sunLight, sunLight.target, fill, fill.target);

    this.earth = buildEarth(RE, assets.earth);
    this.earth.group.position.set(EX, 0, 0);
    faceLongitude(this.earth.mesh, 108);
    this.earth.setSun(sunDir);
    this.root.add(this.earth.group);

    const moon = new THREE.Mesh(new THREE.SphereGeometry(RM, 96, 64), new THREE.MeshStandardMaterial({ map: assets.moon.albedo, normalMap: assets.moon.normal, roughness: 0.96, metalness: 0 }));
    moon.position.set(MX, 0, 0);
    faceLongitude(moon, 0);
    this.root.add(moon);

    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.85, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(RING, 0.022, 8, 240), this.ringMat);
    this.ring.position.set(MX, 0, 0);
    this.root.add(this.ring);

    this.stars = new Stars(520, pixelRatio);
    this.root.add(this.stars);
    this.sun.place(sunDir, 480);
    this.root.add(this.sun);

    this.out1 = new RouteLine(outbound(0, 1.2), new THREE.Color(1.0, 0.66, 0.2), 0.075);
    this.out2 = new RouteLine(outbound(2.3, -2.2), new THREE.Color(1.0, 0.24, 0.16), 0.075);
    this.home = new RouteLine(HOME, new THREE.Color(0.45, 0.9, 1.0), 0.075);
    this.root.add(this.out1, this.out2, this.home, this.landerMk, this.shipMk, this.ascentMk);

    this.node.earth.position.set(EX + 7.2, 8.2, 0);
    this.node.moon.position.set(MX + 1.6, 3.2, 0);
    this.node.dist.position.set(0, 15.2, 0);
    this.root.add(this.node.earth, this.node.moon, this.node.dist);

    const A = (id: string, label: string, target: THREE.Object3D) => ({ id, label, target, local: new THREE.Vector3(), show: false }) as Anchor;
    this.list = [
      A('earth', '地球', this.node.earth),
      A('moon', '月球', this.node.moon),
      A('dist', '', this.node.dist),
      A('lander', '揽月', this.landerMk),
      A('ship', '梦舟', this.shipMk),
      A('ascent', '揽月登月舱', this.ascentMk),
    ];

    this.tracks = {
      0: new CamTrack([
        // opening: skimming above China (about 31°N 110°E), looking along the ground towards the day/night line
        { t: 0, pos: [-36.44, 6.76, 11.0], look: [-36.18, -3.11, 9.42], fov: 46 },
        { t: 5, pos: [-36.3, 6.6, 11.3], look: [-36.1, -3.0, 9.6], fov: 46, ease: 'lin' },
        { t: 13.5, pos: [1.5, 8.5, 94], look: [8, 0.6, 0], fov: 40 },
        { t: 22, pos: [-2.5, 6.2, 88], look: [8.5, 1, 0], fov: 40, ease: 'lin' },
      ]),
      9: new CamTrack([
        { t: 0, pos: [8, 9, 96], look: [8, 0.6, 0], fov: 40 },
        { t: 30, pos: [11.5, 5, 88], look: [8.5, 1.6, 0], fov: 40, ease: 'lin' },
      ]),
    };
  }

  camera(tl: number, out: CamPose): CamPose {
    const act = this.actId;
    if (this.tracks[act]) {
      this.tracks[act].sample(tl, out);
      if (act === 0) {
        // near the ground "up" is away from Earth's centre; it eases to world-up as the camera pulls back
        const k = smootherstep(5, 13.5, tl);
        this.p.subVectors(out.pos, this.earth.group.position).normalize();
        out.up.copy(this.p).lerp(WORLD_UP, k).normalize();
      }
      return out;
    }
    if (act === 2) {
      // both worlds in frame: Earth left, Moon right, the lander's marker riding the arc between them
      const s = easeInOutSine(seg(tl, 0, 8.5));
      out.pos.set(4 + 2 * s, 10 - 3 * s, 100 - 10 * s);
      out.look.set(6, 4 - 2 * s, 0);
      out.fov = 40;
      return out;
    }
    const s = seg(tl, 0, 9);
    out.pos.set(MX - 2 + 1.2 * s, -3.6 + 0.6 * s, 17.5 - 2 * s);
    out.look.set(MX - 2.4, -1.4, 0);
    out.fov = 38;
    return out;
  }

  update(ctx: StageCtx): void {
    const { act, tl } = ctx;
    this.actId = act.id;
    this.camera(tl, this.pose);
    this.earth.update(tl, this.pose.pos);

    const show = (m: THREE.Group, on: boolean, at?: THREE.Vector3) => {
      m.visible = on;
      if (on && at) m.position.copy(at);
    };
    const an = (id: string, on: boolean, label?: string) => {
      const a = this.list.find((x) => x.id === id)!;
      a.show = on;
      if (label !== undefined) a.label = label;
    };

    if (act.id === 0) {
      const k = smoothstep(13.5, 15.5, tl);
      this.out1.set(seg(tl, 15, 17.2), 0.9 * k, tl, 0, tl > 18 ? 1 : 0);
      this.out2.set(seg(tl, 16.2, 18.4), 0.9 * k, tl, 0, tl > 19 ? 1 : 0);
      this.home.set(seg(tl, 18.4, 20.8), 0.9 * k, tl, 0, tl > 21 ? 1 : 0);
      this.ringMat.opacity = 0.75 * smoothstep(16.8, 18.4, tl);
      show(this.landerMk, false);
      show(this.shipMk, false);
      show(this.ascentMk, false);
      an('earth', tl > 13.5);
      an('moon', tl > 14.5);
      an('dist', tl > 15.2 && tl < 21.6, '地月平均距离 384,400 千米 · 画面距离为示意');
      an('lander', false);
      an('ship', false);
      an('ascent', false);
    } else if (act.id === 2) {
      const p = 0.8 * easeInOutSine(seg(tl, 0, 8.5));
      this.out1.pointAt(p, this.p);
      show(this.landerMk, true, this.p);
      show(this.shipMk, false);
      show(this.ascentMk, false);
      this.out1.set(Math.min(1, p + 0.05), 0.95, tl, 0, 1);
      this.out2.set(1, 0.16, tl, 70, 0);
      this.home.set(0, 0, tl);
      this.ringMat.opacity = 0.4;
      an('earth', true);
      an('moon', true);
      an('dist', false);
      an('lander', true, '揽月 · 无人着陆器');
      an('ship', false);
      an('ascent', false);
    } else if (act.id === 8) {
      const p = easeInOutSine(seg(tl, 0.8, 15));
      this.home.pointAt(p, this.p);
      show(this.shipMk, true, this.p);
      ringPoint(DOCK, this.p);
      this.p.x -= Math.min(tl, 9) * 0.16;
      this.p.y += Math.min(tl, 9) * 0.05;
      show(this.ascentMk, tl > 0.9, this.p);
      show(this.landerMk, false);
      this.home.set(Math.min(1, p + 0.05), 0.95, tl, 0, 1);
      this.out1.set(1, 0.22, tl, 90, 0);
      this.out2.set(1, 0.22, tl, 90, 0);
      this.ringMat.opacity = 0.7;
      an('earth', true);
      an('moon', true);
      an('dist', false);
      an('lander', false);
      an('ascent', tl > 0.9);
      an('ship', true);
    } else {
      this.out1.set(1, 0.62, tl, 0, 1);
      this.out2.set(1, 0.62, tl, 0, 1);
      this.home.set(1, 0.62, tl, 0, 1);
      this.ringMat.opacity = 0.75;
      show(this.landerMk, false);
      show(this.shipMk, false);
      show(this.ascentMk, false);
      // the closing title owns the middle of the frame
      an('earth', tl < act.ev.close);
      an('moon', tl < act.ev.close);
      an('dist', false);
      an('lander', false);
      an('ship', false);
      an('ascent', false);
    }
  }

  anchors(): Anchor[] {
    return this.list;
  }

  pickRoots(): THREE.Object3D[] {
    return [];
  }

  pip(): CamPose | null {
    return null;
  }

  sound(tl: number): SoundParams {
    const act = this.actId;
    return { thrust: act === 8 ? 0.35 * plateau(tl, 2.4, 8.6) : 0, wind: 0 };
  }

  bloom() {
    return { strength: 0.4, threshold: 1.15 };
  }
}
