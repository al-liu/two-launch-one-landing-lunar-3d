import * as THREE from 'three';
import { Plume, markShadows } from '../../art/geo';
import { Particles } from '../../art/particles';
import { buildParachute, type Parachute } from '../../art/props';
import { canvasTexture, glowCanvas } from '../../art/textures';
import { buildShip, type Ship } from '../../art/ship';
import { easeInOutCubic, lerp, plateau, seg, smoothstep } from '../../core/easing';
import type { Assets } from '../assets';
import { buildLaunchEnv, type LaunchEnv } from '../launch/env';
import { WORLD_UP, newPose, type Anchor, type CamPose, type SoundParams, type Stage, type StageCtx } from '../types';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
const CAP_MID = 2.6;
const NOSE = 6.42;
const LINE = 22;
const ENTRY_TILT = 0.58;
const CHUTE_TOP = NOSE + LINE;
/** The sky's horizon is drawn for a smaller planet, so it gets a reduced altitude: enough to show the curve, not a ball. */
const SKY_ALT = 0.3;

/** Height in metres over the splash-down point. Time is compressed: the real descent takes many minutes. */
function altitude(tl: number, ev: Record<string, number>): number {
  if (tl < ev.reentry) return lerp(110000, 80000, seg(tl, 9, ev.reentry));
  if (tl < ev.chute) return lerp(80000, 2500, easeInOutCubic(seg(tl, ev.reentry, ev.chute)));
  if (tl < ev.splash) return 2500 * Math.pow(1 - seg(tl, ev.chute, ev.splash), 2.2);
  return 0;
}

const SHELL_FRAG = /* glsl */ `
uniform float uHeat, uTime;
varying vec3 vN; varying vec3 vV;
void main() {
  float facing = clamp(abs(dot(normalize(vN + vec3(1e-6)), normalize(vV + vec3(1e-6)))), 0.0, 1.0);
  float rim = pow(1.0 - facing, 1.6);
  float flick = 0.84 + 0.16 * sin(uTime * 57.0 + facing * 31.0) * sin(uTime * 23.0);
  vec3 col = mix(vec3(1.0, 0.42, 0.78), vec3(1.0, 0.78, 0.46), facing);
  float a = (0.12 + 0.88 * rim) * uHeat * flick * 0.55;
  gl_FragColor = vec4(col * a * 1.25, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ReentryStage implements Stage {
  readonly id = 'reentry';
  readonly root = new THREE.Group();
  readonly near = 0.5;
  readonly far = 90000;
  readonly ambient = 1;
  private env: LaunchEnv;
  private craft = new THREE.Group();
  private hang = new THREE.Group();
  private ship: Ship;
  private chute: Parachute;
  private shellMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uHeat: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: SHELL_FRAG,
  });
  private shell: THREE.Mesh;
  // a soft-edged wake: orange where it leaves the capsule, magenta further back
  private trail = new Plume(C(0.9, 0.28, 0.95), 110, 11, 48, C(1.0, 0.5, 0.72), 2.2);
  private fireball: THREE.Sprite;
  private streaks: Particles;
  private spray: Particles;
  private foam: THREE.Mesh;
  private foamMat = new THREE.MeshBasicMaterial({ color: C(0.95, 0.97, 1.0), transparent: true, opacity: 0, depthWrite: false });
  private fire = new THREE.PointLight(0xff7a3a, 0, 0, 1.6);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private nodes: Record<string, THREE.Object3D> = {};
  private list: Anchor[];
  private evNow: Record<string, number> = {};
  private heat = 0;
  private ctx: StageCtx | null = null;
  private pose = newPose();
  private centre = new THREE.Vector3();
  private w = new THREE.Vector3();
  private w2 = new THREE.Vector3();

  constructor(assets: Assets, pixelRatio: number) {
    const q = assets.quality.particles;
    this.env = buildLaunchEnv(pixelRatio, false);
    this.root.add(this.env.group);
    const sun = new THREE.DirectionalLight(0xffe2c4, 3.0);
    sun.position.copy(this.env.sunDir).multiplyScalar(300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 1;
    sc.far = 700;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    this.sun = sun;
    // sky light above, Earth or sea below
    this.hemi = new THREE.HemisphereLight(0x5f77a8, 0x8a7f72, 0.6);
    this.root.add(sun, sun.target, this.hemi, this.fire);

    // The capsule hangs from its nose so it can swing under the parachute; the service module stays behind.
    this.ship = buildShip();
    this.ship.setTower(false);
    this.ship.setSolar(1);
    this.ship.wall.metalness = 0.5;
    markShadows(this.ship.root);
    this.hang.add(this.ship.capsule);
    this.ship.capsule.position.set(0, -NOSE, 0);
    this.ship.root.position.y = -7;
    this.craft.add(this.ship.root, this.hang);
    this.root.add(this.craft);

    this.shell = new THREE.Mesh(new THREE.SphereGeometry(4.6, 48, 32), this.shellMat);
    this.shell.scale.set(1.06, 0.5, 1.06);
    this.shell.position.y = -0.5;
    this.shell.renderOrder = 9;
    this.shell.raycast = () => {};
    this.ship.capsule.add(this.shell);
    this.trail.rotation.z = Math.PI;
    this.trail.position.y = 3.4;
    this.ship.capsule.add(this.trail);
    // the shock layer ahead of the heat shield: a soft fireball that the capsule rides on
    this.fireball = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: canvasTexture(glowCanvas(128, '#ffffff', 2.6)), color: C(1.0, 0.5, 0.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.fireball.position.y = -1.6;
    this.fireball.raycast = () => {};
    this.ship.capsule.add(this.fireball);

    // glowing shards torn off the shock layer, streaking back past the capsule
    this.streaks = new Particles({
      count: Math.round(240 * q),
      seed: 61,
      additive: true,
      spawn: (_i, rnd, out) => {
        const a = rnd() * Math.PI * 2;
        const r = 2.6 + rnd() * 2.0;
        out.offset.set(Math.cos(a) * r, -1.6 + rnd() * 3.2, Math.sin(a) * r);
        out.vel.set(Math.cos(a) * (2 + rnd() * 6), 55 + rnd() * 80, Math.sin(a) * (2 + rnd() * 6));
      },
    });
    this.ship.capsule.add(this.streaks);

    this.chute = buildParachute(LINE);
    markShadows(this.chute.canopy);
    this.chute.root.position.y = CHUTE_TOP;
    this.hang.add(this.chute.root);

    this.spray = new Particles({
      count: Math.round(300 * q),
      seed: 62,
      spawn: (_i, rnd, out) => {
        const a = rnd() * Math.PI * 2;
        const r = 1.6 + rnd() * 1.2;
        out.offset.set(Math.cos(a) * r, 0, Math.sin(a) * r);
        out.vel.set(Math.cos(a) * (9 + rnd() * 15), 9 + rnd() * 16, Math.sin(a) * (9 + rnd() * 15));
      },
    });
    this.foam = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), this.foamMat);
    this.foam.rotation.x = -Math.PI / 2;
    this.foam.position.y = 0.25;
    this.root.add(this.spray, this.foam);

    const mk = (id: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const o = new THREE.Object3D();
      o.position.set(x, y, z);
      parent.add(o);
      this.nodes[id] = o;
      return o;
    };
    const A = (id: string, label: string, target: THREE.Object3D, part?: string) => ({ id, label, target, local: new THREE.Vector3(), show: false, part }) as Anchor;
    this.list = [
      A('capsule', '返回舱', mk('capsule', this.ship.capsule, 0, 3.1, 2.92), 'capsule'),
      A('service', '服务舱', mk('service', this.ship.root, 0, 3.5, 2.5), 'serviceModule'),
      A('chute', '降落伞', mk('chute', this.chute.canopy, 0, -2.6, 9.6)),
      A('earth', '地球', mk('earth', this.root, 0, 0, 0)),
    ];
  }

  // ---- camera -------------------------------------------------------------------------------
  camera(tl: number, out: CamPose): CamPose {
    const ev = this.evNow;
    out.up.copy(WORLD_UP);
    if (tl < ev.sep) return this.dolly(out, [24, 15, 46], [20, 12, 40], [-1, -7, 0], [-1, -7, 0], 40, seg(tl, 9, ev.sep));
    // sun side of the capsule: the discarded service module falls away up and to the left
    if (tl < 15.4) return this.dolly(out, [22, 8, 30], [18, 6, 26], [-1, -5, 0], [-0.5, -4, 0], 40, seg(tl, ev.sep, 15.4));
    if (tl < 23.4) {
      const k = seg(tl, 15.4, 23.4);
      // from below and ahead: the capsule is set against the black sky, with the Earth's limb along the bottom of the frame
      this.dolly(out, [-24, -9, 40], [-19, -7, 32], [3, 1.5, 0], [3, 1.5, 0], 44, k);
      // buffet: a small, fast tremble that follows the heating
      const s = this.ctx?.reduced ? 0 : this.heat * 0.16;
      out.pos.x += Math.sin(tl * 71) * s;
      out.pos.y += Math.sin(tl * 93 + 1.3) * s;
      return out;
    }
    if (tl < 25.8) return this.dolly(out, [-30, 14, 46], [-26, 12, 40], [0, 12, 0], [0, 12, 0], 46, seg(tl, 23.4, 25.8));
    if (tl < ev.splash) return this.dolly(out, [-34, 2, 44], [-30, 0, 38], [0, 10, 0], [0, 10, 0], 46, seg(tl, 25.8, ev.splash));
    return this.dolly(out, [22, 9, 34], [20, 6, 30], [0, 2.5, 0], [0, 2.5, 0], 40, seg(tl, ev.splash, 34));
  }

  /** Positions are offsets from the capsule's centre, in world axes, so the vehicle stays put while the Earth rises. */
  private dolly(out: CamPose, p0: number[], p1: number[], l0: number[], l1: number[], fov: number, k: number): CamPose {
    out.pos.fromArray(p0).lerp(this.w.fromArray(p1), k).add(this.centre);
    out.look.fromArray(l0).lerp(this.w2.fromArray(l1), k).add(this.centre);
    out.fov = fov;
    return out;
  }

  // ---- state --------------------------------------------------------------------------------
  update(ctx: StageCtx): void {
    const { act, tl } = ctx;
    const ev = act.ev;
    this.evNow = ev;
    this.ctx = ctx;
    const alt = altitude(tl, ev);

    // ---- vehicles ------------------------------------------------------------------------------
    // the capsule pulls ahead of the discarded service module, quickly at first, then settles at a fixed distance
    const s = Math.max(0, tl - ev.sep);
    this.hang.position.set(6 * Math.tanh((s * s) / 24), 40 * Math.tanh((s * s) / 40), 0);
    const upright = smoothstep(ev.chute, ev.chuteFull, tl);
    const swing = tl < ev.splash ? 0.1 * Math.sin((tl - ev.chuteFull) * 1.7) * upright : 0;
    const bob = tl >= ev.splash ? Math.sin((tl - ev.splash) * 2.3) * Math.exp(-(tl - ev.splash) * 0.5) : 0;
    this.craft.rotation.set(swing + (tl >= ev.splash ? 0.1 * bob : 0), 0, ENTRY_TILT * (1 - upright) + (tl >= ev.splash ? 0.08 * Math.sin((tl - ev.splash) * 1.6) : 0));
    // the altitude is that of the capsule's base: the group is shifted so the service module trails behind it
    const draft = tl >= ev.splash ? -0.4 + 0.22 * bob : 0;
    this.w.set(this.hang.position.x, this.hang.position.y - NOSE, 0).applyEuler(this.craft.rotation);
    this.craft.position.set(-this.w.x, alt + draft - this.w.y, -this.w.z);

    // from the re-entry shot on the service module has left the story; it would otherwise drift through the foreground
    this.ship.root.visible = tl < 15.4;

    // ---- parachute -------------------------------------------------------------------------------
    let inflate = 0;
    if (tl >= ev.chute) inflate = tl < 24.4 ? lerp(0.08, 0.2, seg(tl, ev.chute, 24.4)) : lerp(0.2, 1, smoothstep(24.4, ev.chuteFull, tl));
    if (tl >= ev.splash) inflate = lerp(1, 0.05, smoothstep(ev.splash + 0.3, ev.splash + 2.6, tl));
    this.chute.set(inflate);
    // after splash-down the canopy settles onto the water beside the capsule
    const drop = smoothstep(ev.splash + 0.2, ev.splash + 2.2, tl);
    this.chute.root.position.y = lerp(NOSE + LINE * Math.max(inflate, 0.08), 1.6, drop);
    this.chute.root.rotation.z = lerp(0.05 * Math.sin(tl * 1.3), 1.45, drop);

    // ---- re-entry heating --------------------------------------------------------------------------
    this.heat = plateau(tl, ev.reentry, ev.reentryEnd, 2.2, 2.2);
    this.shellMat.uniforms.uHeat.value = this.heat;
    this.shellMat.uniforms.uTime.value = tl;
    this.shell.visible = this.heat > 0.01;
    this.trail.set(this.heat * (0.62 + 0.08 * Math.sin(tl * 47) * Math.sin(tl * 17)), tl, 0.8 + 0.5 * this.heat, 1.2);
    this.fireball.visible = this.heat > 0.01;
    this.fireball.material.opacity = this.heat * (0.86 + 0.14 * Math.sin(tl * 57) * Math.sin(tl * 23));
    this.fireball.scale.setScalar((15 + 1.5 * Math.sin(tl * 61)) * (0.6 + 0.4 * this.heat));
    this.streaks.emit({
      time: tl,
      life: 0.5,
      size0: 0.12,
      size1: 0.34,
      stretch: 3,
      fadeIn: 0.02,
      fadePow: 1.2,
      soft: 0.4,
      opacity: this.heat,
      intensity: 1.1,
      flicker: 0.5,
      colorA: C(2.2, 1.1, 0.5),
      colorB: C(1.3, 0.35, 0.7),
    });
    this.fire.position.y = -2.6;
    this.fire.intensity = this.heat * 900 * (0.85 + 0.15 * Math.sin(tl * 61));
    this.ship.shield.material.emissive.setRGB(1.0, 0.36, 0.08);
    this.ship.shield.material.emissiveIntensity = this.heat * 3.2;
    this.ship.shield.material.color.setRGB(0.29, 0.23, 0.19).lerp(new THREE.Color(0.6, 0.2, 0.05), this.heat);
    this.ship.wall.emissive.setRGB(1.0, 0.4, 0.2);
    this.ship.wall.emissiveIntensity = this.heat * 0.3;

    // ---- splash-down ---------------------------------------------------------------------------------
    this.spray.position.y = 0;
    this.spray.emit({
      time: tl - ev.splash,
      life: 2.8,
      once: true,
      size0: 1.0,
      size1: 5.5,
      drag: 0.6,
      accel: V(0, -9.8, 0),
      fadeIn: 0.02,
      fadePow: 1.3,
      soft: 0.7,
      noise: 0.35,
      opacity: 0.8,
      colorA: C(0.94, 0.96, 0.98),
      colorB: C(0.66, 0.74, 0.82),
    });
    const foamK = seg(tl, ev.splash, ev.splash + 5);
    this.foam.scale.setScalar(lerp(3, 22, Math.sqrt(foamK)));
    this.foamMat.opacity = (tl >= ev.splash ? 0.7 * (1 - foamK) : 0) * (0.8 + 0.2 * Math.sin(tl * 9));
    this.foam.visible = this.foamMat.opacity > 0.01;

    // ---- environment ------------------------------------------------------------------------------------
    this.craft.updateMatrixWorld(true);
    this.centre.copy(this.hang.position).add(this.w.set(0, CAP_MID - NOSE, 0)).applyMatrix4(this.craft.matrixWorld);
    this.camera(tl, this.pose);
    const a = smoothstep(2500, 14000, alt);
    this.env.setAltitude(alt * SKY_ALT, a, this.pose.pos);
    this.env.setTime(tl);
    this.sun.intensity = 3.0 + 0.4 * a;
    this.sun.color.setRGB(1.0, 0.89 + 0.08 * a, 0.77 + 0.2 * a);
    this.sun.target.position.copy(this.centre);
    this.sun.position.copy(this.centre).addScaledVector(this.env.sunDir, 260);
    this.sun.target.updateMatrixWorld();
    this.hemi.intensity = 0.6 + 1.3 * (1 - a);
    this.nodes.earth.position.copy(this.centre).add(this.w.set(-3000, -9000, -12800));

    // ---- labels -------------------------------------------------------------------------------------------
    const set = (key: string, show: boolean, label?: string) => {
      const o = this.list.find((x) => x.id === key)!;
      o.show = show;
      if (label !== undefined) o.label = label;
    };
    set('capsule', tl > 9.6, tl >= ev.reentry && tl < ev.reentryEnd ? '返回舱 · 再入大气层' : tl >= ev.chute ? '返回舱 · 开伞' : '返回舱');
    set('service', tl < 13.5);
    set('chute', tl > ev.chuteFull && tl < ev.splash + 2.5, '降落伞');
    set('earth', tl > 9.8 && tl < 25.8);
  }

  pip(): CamPose | null {
    return null;
  }

  anchors(): Anchor[] {
    return this.list;
  }

  pickRoots(): THREE.Object3D[] {
    return [this.ship.root, this.ship.capsule];
  }

  sound(tl: number): SoundParams {
    const ev = this.evNow;
    return { thrust: 0, wind: Math.max(this.heat, 0.4 * plateau(tl, ev.chute ?? 24, 99, 1, 2)) };
  }

  bloom() {
    return { strength: 0.45 + 0.45 * this.heat, threshold: 1.2 };
  }
}
