import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { clamp } from '../core/easing';
import { ACTS, TOTAL, locate } from '../core/timeline';
import { CameraRig } from './rig';
import { stageFor, newPose, type Anchor, type CamPose, type Quality, type SoundParams, type Stage } from '../stages/types';

export interface PipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FrameInfo {
  T: number;
  act: number;
  tl: number;
  /** 0..1 progress inside the act. */
  u: number;
  playing: boolean;
  stage: string;
  stageChanged: boolean;
  pip: PipRect | null;
  fade: number;
  fps: number;
  sound: SoundParams;
}

const DESIGN_ASPECT = 16 / 9;

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig = new CameraRig();
  readonly quality: Quality;
  readonly reducedMotion: boolean;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private stages: Record<string, Stage> = {};
  private current: Stage | null = null;
  private pipCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.2, 5000);
  private pose = newPose();
  private pipPose = newPose();
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  /** Device pixel ratio as capped for this device; the working ratio may be lower. */
  private maxRatio = 1;
  private scale = 1;
  private fade = 0;
  private raf = 0;
  private last = 0;
  /** Frame interval of a bare clear, measured before the first real frame: the fastest this browser and display can show WebGL. */
  private floorMs = 0;
  private intervals: number[] = [];
  private checkIn = 0;
  private lateChecks = 0;
  private briskChecks = 0;
  private recoveries = 0;
  fps = 60;
  /** True while the background warm-up renders other stages: no stage fade, no interface updates. */
  private warming = false;
  private stageChanged = false;
  private pipRect: PipRect | null = null;
  private tmp = new THREE.Vector3();

  T = 0;
  playing = false;
  speed = 1;
  onUpdate: ((info: FrameInfo) => void) | null = null;
  /** Fires when the play state changes (button, keyboard, end of timeline). */
  onPlayState: ((playing: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, quality: Quality) {
    this.quality = quality;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 1);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    this.scene.environment = this.lunarEnvironment();
    this.scene.environmentIntensity = 0;

    if (!quality.mobile) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.55, 1.0);
      this.guardBloom(this.bloom);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resize();
  }

  /**
   * The blur chain spreads a single NaN or huge pixel over the whole frame (seen as a black flash).
   * The pass exposes its high-pass material, so its shader is swapped for one that drops such texels.
   */
  private guardBloom(bloom: UnrealBloomPass): void {
    const src = bloom.materialHighPassFilter;
    src.fragmentShader = /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 defaultColor;
      uniform float defaultOpacity;
      uniform float luminosityThreshold;
      uniform float smoothWidth;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        // NaN is the only value unequal to itself
        if (any(notEqual(texel, texel))) texel = vec4(0.0);
        texel = min(texel, vec4(64.0));
        float v = dot(texel.xyz, vec3(0.2126, 0.7152, 0.0722));
        float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
        gl_FragColor = mix(vec4(defaultColor, defaultOpacity), texel, alpha);
      }`;
    src.needsUpdate = true;
  }

  /** Sunlit regolith below, space above: gives metals something to reflect other than the sun. */
  private lunarEnvironment(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgb(2,2,3)');
    g.addColorStop(0.46, 'rgb(4,4,5)');
    g.addColorStop(0.54, 'rgb(38,37,35)');
    g.addColorStop(1, 'rgb(44,43,41)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 32);
    const eq = new THREE.CanvasTexture(c);
    eq.colorSpace = THREE.SRGBColorSpace;
    eq.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const tex = pmrem.fromEquirectangular(eq).texture;
    pmrem.dispose();
    eq.dispose();
    return tex;
  }

  addStage(stage: Stage): void {
    this.scene.add(stage.root);
    stage.root.visible = false;
    this.stages[stage.id] = stage;
  }

  setPixelRatio(pr: number): void {
    this.maxRatio = pr;
    this.fitPixelRatio();
    this.applySize();
  }

  /** Drawing-buffer pixels to aim for. Beyond about two million, bloom and anti-aliasing cost more frame rate than they add on a projector. */
  private fitPixelRatio(): void {
    const budget = this.quality.mobile ? 1_500_000 : 2_200_000;
    this.pixelRatio = Math.min(this.maxRatio, Math.sqrt(budget / Math.max(1, this.width * this.height)));
  }

  private applySize(): void {
    const w = Math.max(1, this.width);
    const h = Math.max(1, this.height);
    this.renderer.setPixelRatio(this.pixelRatio * this.scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.pixelRatio * this.scale);
    this.composer?.setSize(w, h);
  }

  private resize = (): void => {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.fitPixelRatio();
    this.applySize();
  };

  private onVisibility = (): void => {
    if (!document.hidden) this.last = performance.now();
  };

  // ---- viewer input ----------------------------------------------------------------------
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;

  private onDown = (e: PointerEvent): void => {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  private onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      const k = (2 * Math.PI) / Math.max(420, this.height);
      this.rig.rotate((e.clientX - prev.x) * k * 1.1, (e.clientY - prev.y) * k * 1.1);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch > 0) this.rig.dolly(this.pinch / Math.max(1, d));
      this.pinch = d;
    }
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    this.pinch = 0;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.rig.dolly(Math.exp(clamp(e.deltaY, -120, 120) * 0.0022));
  };

  // ---- transport ---------------------------------------------------------------------------
  play(): void {
    if (this.speed >= 0 ? this.T >= TOTAL - 0.01 : this.T <= 0.01) this.T = this.speed >= 0 ? 0 : TOTAL;
    if (!this.playing) {
      this.playing = true;
      this.last = performance.now();
      this.onPlayState?.(true);
    }
  }

  pause(): void {
    if (this.playing) {
      this.playing = false;
      this.onPlayState?.(false);
    }
  }

  seek(T: number): void {
    this.T = clamp(T, 0, TOTAL);
    this.renderFrame(0);
  }

  actStart(act: number): number {
    return ACTS.reduce((s, a, i) => (i < act ? s + a.duration : s), 0);
  }

  seekAct(act: number, tl = 0): void {
    this.seek(ACTS[act] ? this.actStart(act) + tl : 0);
  }

  /** Begins the render loop. The first frame is drawn by `onReady`, after the calibration frames. */
  start(onReady?: () => void): void {
    // Calibrate before the first real frame: a throttled browser or a slow display limits the frame rate whatever the
    // GPU does, and must not be mistaken for an overloaded GPU later on.
    const samples: number[] = [];
    let last = performance.now();
    const probe = (now: number) => {
      if (now > last) samples.push(now - last);
      last = now;
      this.renderer.clear();
      if (samples.length < 10) requestAnimationFrame(probe);
      else {
        samples.sort((a, b) => a - b);
        this.floorMs = samples[samples.length >> 1];
        this.last = performance.now();
        this.loop(this.last);
        onReady?.();
      }
    };
    requestAnimationFrame(probe);
  }

  private loop = (now: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    const raw = (now - this.last) / 1000;
    const dt = clamp(raw, 0, 0.1);
    this.last = now;
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;
    if (this.playing) {
      this.T += dt * this.speed;
      // two callbacks can share a timestamp, e.g. the first one after play() at the opening frame:
      // a frame that moved the playhead nowhere cannot have reached either end
      if (dt > 0 && (this.T >= TOTAL || this.T <= 0)) {
        // playing backwards stops at the opening frame
        this.T = clamp(this.T, 0, TOTAL);
        this.playing = false;
        this.onPlayState?.(false);
      }
    }
    this.renderFrame(dt);
  };

  /** Keep the director's horizontal framing on narrow (portrait) screens by backing off and widening slightly. */
  private fitAspect(pose: CamPose, aspect: number, floor?: number): void {
    const f = clamp(DESIGN_ASPECT / Math.max(0.3, aspect), 1, 2.8);
    if (f <= 1.001) return;
    const fov2 = Math.min(64, pose.fov * Math.pow(f, 0.4));
    const hw0 = Math.atan(Math.tan((pose.fov * Math.PI) / 360) * DESIGN_ASPECT);
    const hw1 = Math.atan(Math.tan((fov2 * Math.PI) / 360) * aspect);
    let k = clamp(Math.tan(hw0) / Math.tan(hw1), 1, 3.2);
    // a camera that looks up from close to the ground would be pushed underground: it stays where it is and shows less to the sides
    if (floor !== undefined && pose.pos.y < pose.look.y) k = Math.max(1, Math.min(k, (pose.look.y - floor) / (pose.look.y - pose.pos.y)));
    this.tmp.subVectors(pose.pos, pose.look).multiplyScalar(k);
    pose.pos.copy(pose.look).add(this.tmp);
    pose.fov = fov2;
  }

  /**
   * Moments, one per stage and per effect, that are rendered once in the background after the first frame, so that
   * shader compilation happens over the opening title rather than in the middle of the first cut to each stage.
   */
  private static PREWARM = [24, 28.5, 46, 76, 88, 100, 121.5, 128, 148, 165, 180, 197, 212.5, 227, 233, 250, 260, 265, 272];

  prewarm(): void {
    const idle: (f: () => void) => void = window.requestIdleCallback ?? ((f) => window.setTimeout(f, 80));
    const step = () => {
      const warm = App.PREWARM.shift();
      if (warm === undefined) return;
      // the interface is not told about these frames, the fade on screen is left alone, and whatever is on screen now
      // (the playhead may have moved meanwhile) is put back before the task ends
      const { T, onUpdate } = this;
      this.onUpdate = null;
      this.warming = true;
      this.T = warm;
      this.renderFrame(0);
      this.T = T;
      this.renderFrame(0);
      this.warming = false;
      this.onUpdate = onUpdate;
      if (App.PREWARM.length) idle(step);
    };
    idle(step);
  }

  /** Advance one frame at the current time (dt only drives fades, the view blend and adaptive quality). */
  renderFrame(dt: number): void {
    if (dt > 0 && this.floorMs > 0) {
      // Adaptive resolution: trade pixels for frame rate only when the scene, not the display, holds the frames back.
      this.intervals.push(dt * 1000);
      if (this.intervals.length > 120) this.intervals.shift();
      this.checkIn += dt;
      if (this.checkIn > 2.5) {
        this.checkIn = 0;
        const sorted = [...this.intervals].sort((a, b) => a - b);
        const frameMs = sorted[sorted.length >> 1];
        // a browser or display that presents a bare frame at 40 frames per second or less: fewer pixels would buy nothing
        if (this.floorMs > 25) {
          if (this.scale < 1) {
            this.scale = 1;
            this.applySize();
          }
        } else if (frameMs > Math.max(22, this.floorMs * 1.3)) {
          // two checks in a row, then on every check: a stage change or a shader compile is not a trend
          this.briskChecks = 0;
          if (++this.lateChecks >= (this.scale < 1 ? 1 : 2) && this.scale > 0.6) {
            this.lateChecks = 0;
            this.scale = Math.max(0.6, this.scale - 0.12);
            this.applySize();
          }
        } else {
          this.lateChecks = 0;
          // after a long spell at full speed, win resolution back; twice at most, so that borderline systems settle
          if (frameMs < 17.5 && this.scale < 1 && ++this.briskChecks >= 12 && this.recoveries < 2) {
            this.briskChecks = 0;
            this.recoveries++;
            this.scale = Math.min(1, this.scale + 0.12);
            this.applySize();
          }
        }
      }
    }
    const aspect = this.width / Math.max(1, this.height);
    const loc = locate(this.T);
    const stage = this.stages[stageFor(loc.act, loc.tl)] ?? Object.values(this.stages)[0];
    if (!stage) return;
    this.stageChanged = false;
    if (stage !== this.current) {
      if (this.current) this.current.root.visible = false;
      stage.root.visible = true;
      this.current = stage;
      this.fade = this.warming || this.reducedMotion ? 0 : 1;
      this.stageChanged = true;
      this.camera.near = stage.near;
      this.camera.far = stage.far;
      this.camera.updateProjectionMatrix();
      this.scene.environmentIntensity = stage.ambient ?? 0;
    }
    this.fade = Math.max(0, this.fade - dt / 0.55);

    stage.update({ act: ACTS[loc.act], tl: loc.tl, aspect, quality: this.quality, reduced: this.reducedMotion });
    stage.camera(loc.tl, this.pose);
    this.fitAspect(this.pose, aspect, stage.camFloor);
    this.rig.apply(this.pose, dt, this.camera, stage.near * 6);

    const pip = stage.pip(loc.tl, this.pipPose);
    if (pip) {
      // the style sheet lays the interface out in one column from 980 px down: the close-up follows that layout
      const compact = this.width <= 980;
      const w = clamp(this.width * (compact ? 0.46 : 0.2), 150, 340);
      const h = (w * 9) / 16;
      const left = compact ? (this.width - w) / 2 : 28;
      // below the act title at top left, and in the one-column layout below the status panel
      const top = compact ? 218 : 132;
      this.pipRect = { left, top, width: w, height: h };
    } else this.pipRect = null;

    if (this.composer) {
      const b = stage.bloom();
      this.bloom!.strength = b.strength;
      this.bloom!.threshold = b.threshold;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    if (pip && this.pipRect) {
      const r = this.pipRect;
      const y = this.height - r.top - r.height;
      const cam = this.pipCam;
      cam.position.copy(pip.pos);
      cam.lookAt(pip.look);
      if (cam.fov !== pip.fov) {
        cam.fov = pip.fov;
        cam.updateProjectionMatrix();
      }
      cam.near = stage.near;
      cam.far = stage.far;
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.setScissorTest(true);
      // the renderer scales the viewport and the scissor by the pixel ratio itself: these are CSS pixels
      this.renderer.setViewport(r.left, y, r.width, r.height);
      this.renderer.setScissor(r.left, y, r.width, r.height);
      this.renderer.clearDepth();
      this.renderer.render(this.scene, cam);
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, this.width, this.height);
      this.renderer.setScissor(0, 0, this.width, this.height);
      this.renderer.autoClear = autoClear;
    }
    this.onUpdate?.({ T: this.T, act: loc.act, tl: loc.tl, u: loc.u, playing: this.playing, stage: stage.id, stageChanged: this.stageChanged, pip: this.pipRect, fade: this.fade, fps: this.fps, sound: stage.sound(loc.tl) });
  }

  /** Screen position (CSS px) of a world point; false when it is behind the camera. */
  project(v: THREE.Vector3, out: { x: number; y: number; visible: boolean }): boolean {
    this.tmp.copy(v).project(this.camera);
    out.x = (this.tmp.x * 0.5 + 0.5) * this.width;
    out.y = (-this.tmp.y * 0.5 + 0.5) * this.height;
    out.visible = this.tmp.z > -1 && this.tmp.z < 1;
    return out.visible;
  }

  get raycaster(): THREE.Raycaster {
    return (this._ray ??= new THREE.Raycaster());
  }
  private _ray: THREE.Raycaster | null = null;
  private ndc = new THREE.Vector2();

  stageId(): string {
    return this.current?.id ?? '';
  }

  /** Labels and hotspots of the current stage. */
  anchors(): Anchor[] {
    return this.current?.anchors() ?? [];
  }

  /** True when something other than `own` (or its children) sits in front of a world point. */
  occluded(point: THREE.Vector3, own: THREE.Object3D): boolean {
    if (!this.current) return false;
    const dist = this.camera.position.distanceTo(point);
    this.raycaster.set(this.camera.position, this.tmp.copy(point).sub(this.camera.position).normalize());
    this.raycaster.far = dist;
    const hit = this.raycaster.intersectObjects(this.pickables(), true)[0];
    this.raycaster.far = Infinity;
    if (!hit) return false;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (o === own) return false;
    return hit.distance < dist - 0.25;
  }

  /** Objects of the current stage that respond to clicking. */
  pickables(): THREE.Object3D[] {
    return this.current?.pickRoots() ?? [];
  }

  /** First object under a screen point that belongs to a named part. */
  pick(x: number, y: number): { part: string; object: THREE.Object3D } | null {
    if (!this.current) return null;
    this.ndc.set((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables(), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        if (o.userData.part) return { part: o.userData.part, object: o };
        o = o.parent;
      }
    }
    return null;
  }

  pixelScale(): number {
    return this.renderer.getPixelRatio();
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.renderer.dispose();
  }
}
