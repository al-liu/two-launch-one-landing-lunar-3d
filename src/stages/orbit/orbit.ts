import * as THREE from 'three';
import { materials, Plume, markShadows } from '../../art/geo';
import { buildOrbitMoon, type OrbitMoon } from '../../art/moonorbit';
import { Particles } from '../../art/particles';
import { buildEarth, faceLongitude, Stars, SunGlow, type Earth } from '../../art/planet';
import { buildAstronaut, type Astronaut } from '../../art/props';
import { buildLander, type Lander } from '../../art/lander';
import { buildShip, type Ship } from '../../art/ship';
import { canvasTexture, glowCanvas } from '../../art/textures';
import { plateau, seg, smootherstep, smoothstep } from '../../core/easing';
import { missionState } from '../../core/missionState';
import { ACT_START } from '../../core/timeline';
import type { Assets } from '../assets';
import { WORLD_UP, newPose, type Anchor, type CamPose, type SoundParams, type Stage, type StageCtx } from '../types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);

/** Stand-in Moon radius (the real one is 1737 km) and the height of the vehicles above it. */
const MOON_R = 20000;
const ALT = 300;
/** Docked stack along X: ship base, its nose port, and the lander's footpads. */
const SHIP_X = -6;
const NOSE_X = SHIP_X + 13.42;
const LANDER_X = NOSE_X + 11.02;
const SUN = new THREE.Vector3(-0.32, 0.44, 0.84).normalize();
const EARTH_DIR = new THREE.Vector3(-0.12, 0.11, -0.986).normalize();
const GROUND_RATE = 0.0025;
const RING_R = MOON_R * 1.05;
const PIVOT = V(0, -ALT, 0);

/** Distance still to cover while closing on a docking port: brisk at first, a slow creep over the last metres. */
const closing = (tl: number, t0: number, t1: number, d: number) => (tl >= t1 ? 0 : d * Math.pow(1 - seg(tl, t0, t1), 1.6));
const gapOf = (id: number, tl: number, ev: Record<string, number>): number =>
  id === 4 ? closing(tl, 0, ev.contact, 70)
  : id === 5 ? (tl < ev.undock ? 0 : 16 * (1 - Math.exp(-(tl - ev.undock) * 0.55)))
  : id === 7 ? closing(tl, ev.contact - 7.3, ev.contact, 90)
  : 0;

/** Crew transfer route through the docking plane: seat in the ship → ascent cabin. */
const PATH = new THREE.CatmullRomCurve3([V(2.9, -0.8, 0.9), V(5.3, -0.1, 0.3), V(9.3, 0, 0), V(10.9, -0.5, 0.7)], false, 'centripetal');

const noHit = () => {};

/** Unlit shell for the cut-away: a faint tint and a bright rim, so nothing inside is lost in shading or shadows. */
function glassMaterial(tint: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTint: { value: tint }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTint; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
      void main(){
        float rim = pow(clamp(1.0 - abs(dot(normalize(vN + vec3(1e-6)), normalize(vV + vec3(1e-6)))), 0.0, 1.0), 2.2);
        gl_FragColor = vec4(uTint * (0.25 + 0.9 * rim), (0.07 + 0.6 * rim) * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class OrbitStage implements Stage {
  readonly id = 'orbit';
  readonly root = new THREE.Group();
  readonly near = 2;
  readonly far = 150000;
  readonly ambient = 1;
  private moon: OrbitMoon;
  private earth: Earth;
  private ship: Ship;
  private lander: Lander;
  private shipG = new THREE.Group();
  private landerG = new THREE.Group();
  private mainPlume = new Plume(C(1.0, 0.42, 0.14), 36, 5.5, 40, C(1.0, 0.72, 0.42), 2.4);
  private shipRcs: Particles;
  private landerRcs: Particles;
  private dockMat = new THREE.MeshBasicMaterial({ color: 0xff4030 });
  private dockRing: THREE.Mesh;
  private ringMat = new THREE.MeshBasicMaterial({ color: C(0.35, 0.85, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  private marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTexture(glowCanvas(128, '#ffffff', 2.2)), color: C(1.6, 1.05, 0.35), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  private crew: Astronaut[];
  /** Crewed hulls: their opaque material, and the glass shell swapped in for a cut-away. */
  private hulls: { mesh: THREE.Mesh; solid: THREE.Material; glass: THREE.ShaderMaterial }[] = [];
  private glassShip = glassMaterial(C(1.0, 0.36, 0.32));
  private glassLander = glassMaterial(C(1.0, 0.78, 0.36));
  private sample: THREE.Mesh;
  private nodes: Record<string, THREE.Object3D> = {};
  private list: Anchor[];
  private actId = 4;
  private evNow: Record<string, number> = {};
  private pose = newPose();
  private w = new THREE.Vector3();
  private w2 = new THREE.Vector3();
  private w3 = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(assets: Assets, pixelRatio: number) {
    const q = assets.quality.particles;
    const sun = new THREE.DirectionalLight(0xfff6ea, 3.6);
    sun.position.copy(SUN).multiplyScalar(200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 20;
    sc.far = 500;
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.05;
    const fill = new THREE.HemisphereLight(0x3a3a44, 0x8a8276, 0.5);
    const shine = new THREE.DirectionalLight(0xd8d2c8, 0.5);
    shine.position.set(0, -1, 0.3);
    this.root.add(sun, sun.target, fill, shine, shine.target);

    this.moon = buildOrbitMoon(MOON_R, assets);
    this.moon.group.position.set(0, -(MOON_R + ALT), 0);
    this.moon.face(10, -30);
    (this.moon.uniforms.uSun.value as THREE.Vector3).copy(SUN);
    this.root.add(this.moon.group);

    // schematic orbit: passes through the vehicles and clears the ground elsewhere
    this.dockRing = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.045, 8, 64), this.dockMat);
    const orbitRing = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 140, 6, 360), this.ringMat);
    orbitRing.position.set(0, -(MOON_R + ALT) - (RING_R - MOON_R - ALT), 0);
    this.root.add(orbitRing, this.marker);

    this.earth = buildEarth(420, assets.earth);
    this.earth.group.position.copy(EARTH_DIR).multiplyScalar(24500);
    faceLongitude(this.earth.mesh, 115);
    this.earth.setSun(SUN);
    this.root.add(this.earth.group);
    this.root.add(new Stars(60000, pixelRatio));
    const glow = new SunGlow();
    glow.place(SUN, 120000);
    this.root.add(glow);

    this.ship = buildShip();
    this.ship.setTower(false);
    this.ship.setSolar(1);
    markShadows(this.ship.root);
    this.ship.root.rotation.z = -Math.PI / 2;
    this.shipG.position.set(SHIP_X, 0, 0);
    this.shipG.add(this.ship.root);
    this.lander = buildLander();
    markShadows(this.lander.root);
    this.lander.root.rotation.z = Math.PI / 2;
    this.landerG.position.set(LANDER_X, 0, 0);
    this.landerG.add(this.lander.root);
    this.mainPlume.position.copy(this.lander.mainEngine);
    this.lander.root.add(this.mainPlume);
    this.root.add(this.shipG, this.landerG);

    // thruster jets along the local +Y (nose) direction
    const rcsSpawn = (i: number, rnd: () => number, out: { offset: THREE.Vector3; vel: THREE.Vector3 }) => {
      const a = Math.PI / 4 + (i % 4) * (Math.PI / 2);
      out.offset.set(Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0);
      out.vel.set(Math.cos(a) * (0.6 + rnd()), 2.2 + rnd() * 3.2, Math.sin(a) * (0.6 + rnd()));
    };
    this.shipRcs = new Particles({ count: Math.round(70 * q), seed: 31, additive: true, spawn: rcsSpawn });
    this.shipRcs.position.y = 4.3;
    this.ship.root.add(this.shipRcs);
    this.landerRcs = new Particles({ count: Math.round(70 * q), seed: 32, additive: true, spawn: rcsSpawn });
    this.landerRcs.position.y = 9.1;
    this.lander.root.add(this.landerRcs);

    this.dockRing.rotation.y = Math.PI / 2;
    this.dockRing.position.set(NOSE_X - SHIP_X, 0, 0);
    this.shipG.add(this.dockRing);

    for (const [h, glass] of [[this.ship.capsule, this.glassShip], [this.lander.ascent, this.glassLander]] as [THREE.Object3D, THREE.ShaderMaterial][]) {
      h.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) this.hulls.push({ mesh: m, solid: m.material as THREE.Material, glass });
      });
    }
    this.crew = [0, 1, 2].map(() => {
      const a = buildAstronaut();
      markShadows(a.root);
      a.root.userData.part = 'suit';
      a.root.visible = false;
      this.root.add(a.root);
      return a;
    });
    this.sample = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), materials().offwhite);
    this.root.add(this.sample);

    const mk = (id: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.nodes[id] = o;
      return o;
    };
    const e = this.earth.group.position;
    mk('earth', this.root, e.x, e.y + 470, e.z);
    mk('moon', this.root, 0, -(MOON_R + ALT) + MOON_R * 0.7, 0);
    const A = (id: string, label: string, target: THREE.Object3D, part?: string) => ({ id, label, target, local: new THREE.Vector3(), show: false, part }) as Anchor;
    this.list = [
      A('ship', '梦舟', mk('ship', this.ship.root, 0, 10, 3.05), 'ship'),
      A('service', '服务舱', mk('service', this.ship.root, 0, 3.5, 2.5), 'serviceModule'),
      A('ascent', '登月舱', mk('ascent', this.lander.root, 0, 7.7, 1.98), 'ascentStage'),
      A('descent', '推进舱', mk('descent', this.lander.root, 0, 3.6, 2.78), 'descentStage'),
      A('legs', '着陆腿', mk('legs', this.lander.root, 2.6, 2.7, 2.6), 'legs'),
      A('suit', '望宇登月服', mk('suit', this.crew[0].root, 0, 1.45, 0), 'suit'),
      A('earth', '地球', this.nodes.earth),
      A('moon', '月球', this.nodes.moon),
    ];
  }

  // ---- camera -------------------------------------------------------------------------------
  camera(tl: number, out: CamPose): CamPose {
    const id = this.actId;
    out.up.copy(WORLD_UP);
    if (id === 2) return this.cam2(tl, out);
    if (id === 4) {
      if (tl < 8.5) return this.dolly(out, [34, 22, 96], [26, 16, 78], [45, 0, 0], [34, 0, 0], 42, seg(tl, 0, 8.5));
      if (tl < 12.6) return this.dolly(out, [-3, 7.5, 24], [-1, 5.5, 20], [13, 0, 0], [13, 0, 0], 40, seg(tl, 8.5, 12.6));
      if (tl < 15.8) return this.dolly(out, [10, 2.2, 27], [9, 1, 21], [7.9, 0, 0], [7.9, 0, 0], 36, seg(tl, 12.6, 15.8));
      if (tl < 19.4) return this.dolly(out, [-24, 15, 46], [-16, 10, 40], [9, -1, 0], [9, -1, 0], 40, seg(tl, 15.8, 19.4));
      if (tl < 25.4) return this.dolly(out, [6, 5, 20], [9, 3, 17], [8.2, -0.3, 0], [8.2, -0.3, 0], 40, seg(tl, 19.4, 25.4));
      if (tl < 29) return this.dolly(out, [-9, -5, 16], [-7.5, -4, 14], [4.5, 0, 0], [4.5, 0, 0], 38, seg(tl, 25.4, 29));
      return this.dolly(out, [-30, 9, 50], [-22, 6, 42], [9, 0.5, 0], [9, 0.5, 0], 40, seg(tl, 29, 34));
    }
    if (id === 5) return this.dolly(out, [2, 10, 42], [24, 6, 62], [13, 0, 0], [14, -1, 0], 42, smootherstep(0, 8, tl));
    const ax = LANDER_X + gapOf(7, tl, this.evNow);
    // chase camera riding with the ascent stage: it fills the foreground, the waiting ship grows ahead
    if (tl < 15.6) return this.dolly(out, [ax + 15, 5, 8], [ax + 12, 4.5, 15], [ax * 0.42, -0.5, 0], [ax * 0.5 - 2, -0.3, 0], 44, seg(tl, 12.5, 15.6));
    if (tl < 18.4) return this.dolly(out, [13, 5, 36], [11, 3, 30], [13, 0, 0], [13, 0, 0], 40, seg(tl, 15.6, 18.4));
    if (tl < 21.2) return this.dolly(out, [10, 2.6, 21], [9, 1.2, 17], [8.6, 0, 0], [8.6, 0, 0], 34, seg(tl, 18.4, 21.2));
    if (tl < 27.2) return this.dolly(out, [6.5, -3.5, 15.5], [8.5, -2.6, 13], [8.2, 0.2, 0], [8.2, 0.2, 0], 40, seg(tl, 21.2, 27.2));
    return this.dolly(out, [-20, 13, 42], [-12, 8, 35], [8, 0, 0], [8, 0, 0], 40, seg(tl, 27.2, 32));
  }

  private dolly(out: CamPose, p0: number[], p1: number[], l0: number[], l1: number[], fov: number, k: number): CamPose {
    out.pos.fromArray(p0).lerp(this.w.fromArray(p1), k);
    out.look.fromArray(l0).lerp(this.w2.fromArray(l1), k);
    out.fov = fov;
    return out;
  }

  /** Near-lunar-orbit braking burn, then a zoom-out to the whole Moon. */
  private cam2(tl: number, out: CamPose): CamPose {
    if (tl < 16.5) return this.dolly(out, [8, 5, 50], [16, 2, 42], [27, -1.5, 0], [27, -1.5, 0], 40, seg(tl, 8.5, 16.5));
    const k = smootherstep(16.5, 21.5, tl);
    const dir0 = this.w.set(16, ALT + 2, 42).normalize();
    const dir1 = this.w2.set(32000, 58000, 60000).normalize();
    // normalised lerp keeps the pull-back on a smooth arc while the distance grows geometrically
    const dir = this.w3.copy(dir0).multiplyScalar(1 - k).addScaledVector(dir1, k).normalize();
    const drift = (seg(tl, 21.5, 28) * Math.PI) / 12;
    const dx = dir.x * Math.cos(drift) - dir.z * Math.sin(drift);
    dir.z = dir.x * Math.sin(drift) + dir.z * Math.cos(drift);
    dir.x = dx;
    out.pos.copy(PIVOT).addScaledVector(dir, 306 * Math.pow(296, k));
    // settling on the Moon's centre last keeps the horizon in frame while the camera climbs
    const j = k * k;
    out.look.set(27, -1.5, 0).sub(PIVOT).multiplyScalar(1 - j).addScaledVector(this.w.set(0, -MOON_R - ALT, 0).sub(PIVOT), j).add(PIVOT);
    out.fov = 40;
    return out;
  }

  pip(tl: number, out: CamPose): CamPose | null {
    const t0 = this.actId === 4 ? 12.6 : this.actId === 7 ? 18.4 : 99;
    const len = this.actId === 4 ? 3.2 : 2.8;
    if (tl < t0 || tl > t0 + len) return null;
    const k = seg(tl, t0, t0 + len);
    out.pos.set(10.6 - 1.2 * k, 2.3 - 0.6 * k, 6.2 - 0.9 * k);
    out.look.set(NOSE_X + 0.05, 0.45 - 0.2 * k, 0.35);
    out.fov = 34;
    out.up.copy(WORLD_UP);
    return out;
  }

  // ---- state --------------------------------------------------------------------------------
  update(ctx: StageCtx): void {
    const { act, tl } = ctx;
    const id = act.id;
    const ev = act.ev;
    this.actId = id;
    this.evNow = ev;
    const T = ACT_START[id] + tl;

    const gap = gapOf(id, tl, ev);
    this.landerG.position.set(LANDER_X + gap, 0, 0);
    this.shipG.visible = id !== 2;
    this.shipG.rotation.set(0, id === 5 ? Math.PI * smootherstep(ev.turn, ev.turn + 3, tl) : 0, 0);
    const ascentOnly = id === 7;
    this.lander.descent.visible = !ascentOnly;
    this.lander.legs.visible = !ascentOnly;

    // ---- engines ----------------------------------------------------------------------------
    const burn = id === 2 ? plateau(tl, ev.burn - 0.2, ev.burnEnd, 0.8, 0.9) : id === 5 ? plateau(tl, ev.burn - 0.3, 99, 0.8, 0.5) : 0;
    const flick = 0.86 + 0.14 * Math.sin(tl * 53) * Math.sin(tl * 19.3 + 1.1);
    this.mainPlume.set(burn * 0.58 * flick, tl, 0.85 + 0.15 * flick, 1);

    const pulse = (p: Particles, on: number, t0: number, period: number) =>
      p.emit({ time: tl - t0, life: period, size0: 0.35, size1: 2.4, fadeIn: 0.01, fadePow: 11, soft: 0.6, opacity: on, intensity: 1.3, colorA: C(0.9, 0.95, 1.0), colorB: C(0.45, 0.55, 0.8) });
    pulse(this.shipRcs, id === 4 ? plateau(tl, 1.6, 13, 0.3, 0.3) * 0.8 : id === 5 ? plateau(tl, 3, 6.2, 0.3, 0.3) : id === 7 ? plateau(tl, 14.6, 18.6, 0.3, 0.3) * 0.7 : 0, 1.6, id === 5 ? 0.9 : 2.2);
    pulse(this.landerRcs, id === 4 ? plateau(tl, 2.6, 13.2, 0.3, 0.2) : id === 7 ? plateau(tl, 12.8, 18.6, 0.3, 0.2) : 0, 2.6, 2.6);

    // ---- docking ----------------------------------------------------------------------------
    const contact = id === 4 ? ev.contact : id === 7 ? ev.contact : 99;
    const lock = id === 4 ? ev.lock : id === 7 ? ev.lock : 99;
    this.dockRing.visible = tl > contact - 4 && tl < lock + 2.5;
    if (this.dockRing.visible) {
      const done = tl >= lock;
      const f = done ? Math.exp(-(tl - lock) * 3) : 0.55 + 0.45 * Math.sin(tl * 9);
      this.dockMat.color.setRGB(done ? 0.25 + f : f, done ? 1.0 + f : 0.22 * f, done ? 0.5 : 0.12 * f);
    }

    // ---- crew transfer ------------------------------------------------------------------------
    const ghostK = id === 4 ? plateau(tl, 18.6, 27.5, 0.6, 0.7) : id === 7 ? plateau(tl, 22, 28.2, 0.6, 0.7) : 0;
    this.glassShip.uniforms.uOpacity.value = ghostK;
    this.glassLander.uniforms.uOpacity.value = ghostK;
    const glassy = ghostK > 0.01;
    for (const h of this.hulls) {
      h.mesh.material = glassy ? h.glass : h.solid;
      // a glass shell must neither shade the crew inside nor count as cover when labels test for occlusion
      h.mesh.castShadow = !glassy;
      if (glassy) h.mesh.raycast = noHit;
      else Reflect.deleteProperty(h.mesh, 'raycast');
    }
    const st = missionState(T);
    const crewed = id === 4 || id === 7;
    this.crew.forEach((a, i) => {
      a.root.visible = crewed;
      if (!crewed) return;
      const c = st.crew[i];
      const side = i === 0 ? 0.42 : i === 1 ? -0.42 : 0;
      const inward = id === 7 ? -1 : 1;
      if (c.moving >= 0) {
        const m = inward > 0 ? c.moving : 1 - c.moving;
        PATH.getPointAt(m, this.w);
        PATH.getTangentAt(m, this.w2).multiplyScalar(inward > 0 ? 1 : -1);
        this.w.z += side * Math.cos((m - 0.5) * Math.PI);
        a.root.position.copy(this.w).addScaledVector(this.w2, -0.9);
        a.root.quaternion.setFromUnitVectors(this.up, this.w2);
        a.pose({ walk: 0, phase: 0, sit: 0.25, armL: [-1.0, 0.35], armR: [-1.0, 0.35], lean: 0 });
        return;
      }
      const seat: Record<string, [number, number, number]> = {
        ship0: [3.4, -0.9, 1.1], ship1: [2.6, -0.9, 0.2], ship2: [3.1, -0.9, -0.9],
        lander0: [10.6, -0.85, 0.5], lander1: [11.2, -0.85, -0.4],
      };
      a.root.position.fromArray(seat[`${c.place}${i}`] ?? [0, -0.9, 0]);
      a.root.quaternion.identity();
      a.pose({ walk: 0, phase: i * 1.7, sit: 1, armL: [0.9, 0.1], armR: [0.9, 0.1] });
    });
    const boxK = seg(tl, 23.6, 26.6);
    this.sample.visible = id === 7 && tl < 27.6;
    if (this.sample.visible) {
      PATH.getPointAt(1 - boxK, this.w);
      this.sample.position.copy(this.w).add(this.w2.set(0, 0.55, 0.3));
    }

    // ---- backdrop ------------------------------------------------------------------------------
    this.moon.spin(T * GROUND_RATE);
    this.camera(tl, this.pose);
    this.earth.update(tl, this.pose.pos);
    const wide = id === 2 && tl >= 16.5;
    const dist = this.pose.pos.length();
    this.lander.root.visible = !wide || dist < 1500;
    this.marker.visible = id === 2 && dist > 1500;
    this.marker.scale.setScalar(dist * 0.026);
    this.marker.position.set(13, 0, 0);
    this.ringMat.opacity = id === 2 ? 0.9 * smoothstep(0.72, 1, smootherstep(16.5, 21.5, tl)) : 0;

    // ---- labels -------------------------------------------------------------------------------
    const set = (key: string, show: boolean, label?: string) => {
      const a = this.list.find((x) => x.id === key)!;
      a.show = show;
      if (label !== undefined) a.label = label;
    };
    const glass = ghostK > 0.5;
    if (id === 2) {
      set('descent', tl < 16.5, '推进舱 · 近月制动');
      set('ascent', tl < 16.5, '登月舱');
      set('moon', tl > 19.5);
    } else {
      set('ship', id === 7 ? tl > 13 : id === 4 ? tl < 8.5 || (tl > 15.8 && tl < 25.4) : tl < 4.2, id === 7 ? '梦舟' : '梦舟 · 3 名航天员');
      set('service', (id === 4 && (tl < 8.5 || (tl > 15.8 && tl < 19.4))) || (id === 5 && tl < 4.2) || (id === 7 && tl > 27.2));
      set('ascent', (id === 4 && (tl < 8.5 || (tl > 15.8 && tl < 19.4))) || (id === 5 && tl < 4.2) || (id === 7 && tl < 18.4), id === 4 ? '揽月 · 无人着陆器' : '登月舱');
      set('descent', (id === 4 && tl < 8.5) || (id === 5 && tl < 8));
      set('legs', id === 4 ? tl < 8.5 : id === 5 ? tl < 8 : false);
      set('suit', glass && tl < (id === 4 ? 25.4 : 27.2), '望宇登月服');
    }
    set('earth', !(id === 2 && tl > 17) && !(id === 4 && tl > 25.4 && tl < 29));
  }

  anchors(): Anchor[] {
    return this.list;
  }

  pickRoots(): THREE.Object3D[] {
    return [this.ship.root, this.lander.root, ...this.crew.map((a) => a.root)];
  }

  sound(tl: number): SoundParams {
    const ev = this.evNow;
    const thrust = this.actId === 2 ? 0.6 * plateau(tl, ev.burn ?? 99, ev.burnEnd ?? 100, 0.8, 0.9) : this.actId === 5 ? 0.6 * plateau(tl, (ev.burn ?? 99) - 0.3, 99, 0.8, 0.5) : 0;
    return { thrust, wind: 0 };
  }

  bloom() {
    return { strength: 0.42, threshold: 1.25 };
  }
}
