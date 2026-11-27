import * as THREE from 'three';
import { canvasTexture, crumpleNormal, hullCanvas, makeCanvas } from './textures';

let cached: ReturnType<typeof build> | null = null;

function solarCanvas(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#0d1b3d';
  ctx.fillRect(0, 0, 512, 512);
  for (let j = 0; j < 8; j++) {
    for (let i = 0; i < 8; i++) {
      const g = ctx.createLinearGradient(i * 64, j * 64, i * 64 + 64, j * 64 + 64);
      g.addColorStop(0, '#1d3f8f');
      g.addColorStop(0.5, '#2b5fc4');
      g.addColorStop(1, '#152b6a');
      ctx.fillStyle = g;
      ctx.fillRect(i * 64 + 3, j * 64 + 3, 58, 58);
    }
  }
  ctx.strokeStyle = 'rgba(200,215,255,0.5)';
  ctx.lineWidth = 1;
  for (let k = 8; k < 512; k += 16) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k, 512);
    ctx.stroke();
  }
  return c;
}

function build() {
  const crumple = crumpleNormal();
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
  const foil = (color: number, scale: number) => {
    const m = std({ color, metalness: 0.72, roughness: 0.6, normalMap: crumple, normalScale: new THREE.Vector2(scale, scale) });
    return m;
  };
  return {
    hull: std({ map: canvasTexture(hullCanvas(), true, true), roughness: 0.5, metalness: 0.05 }),
    white: std({ color: 0xe9e7e0, roughness: 0.5, metalness: 0.05 }),
    offwhite: std({ color: 0xd8d5cc, roughness: 0.6, metalness: 0.05 }),
    cream: std({ color: 0xf1e9d6, roughness: 0.55, metalness: 0.02 }),
    red: std({ color: 0xc8102e, roughness: 0.45, metalness: 0.1 }),
    dark: std({ color: 0x1c1e22, roughness: 0.55, metalness: 0.6 }),
    metal: std({ color: 0x8b9099, roughness: 0.32, metalness: 0.95 }),
    nozzle: std({ color: 0x2b2724, roughness: 0.45, metalness: 0.85 }),
    nozzleMetal: std({ color: 0x6b6560, roughness: 0.35, metalness: 1.0 }),
    gold: foil(0xe6ab3c, 0.3),
    goldDark: foil(0xb57a22, 0.4),
    silverFoil: foil(0xd2d5da, 0.26),
    glass: std({ color: 0x0b1626, roughness: 0.08, metalness: 0.9 }),
    visor: std({ color: 0xffb534, roughness: 0.05, metalness: 1.0 }),
    solar: std({ map: canvasTexture(solarCanvas(), true, true), roughness: 0.3, metalness: 0.6 }),
    black: std({ color: 0x0a0a0b, roughness: 0.8, metalness: 0.1 }),
    suit: std({ color: 0xf3f1ea, roughness: 0.75, metalness: 0.0 }),
    tire: std({ color: 0x1a1b1e, roughness: 0.9, metalness: 0.3 }),
  };
}

export type Mats = ReturnType<typeof build>;

export function materials(): Mats {
  if (!cached) cached = build();
  return cached;
}

/** Vertical cylinder from y to y+h (optionally tapered). */
export function cyl(r1: number, r2: number, h: number, mat: THREE.Material, segs = 48, y = 0, open = false): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r2, r1, h, segs, 1, open);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y + h / 2;
  return m;
}

/** Bell nozzle: throat radius rt at y=h, exit radius re at y=0, curved profile. */
export function nozzle(rt: number, re: number, h: number, y = 0, segs = 32): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 at exit, 1 at throat
    const r = re + (rt - re) * Math.pow(1 - t, 0.55);
    pts.push(new THREE.Vector2(r, t * h));
  }
  const g = new THREE.LatheGeometry(pts, segs);
  const m = new THREE.Mesh(g, materials().nozzle);
  m.position.y = y;
  return m;
}

export function lathe(profile: [number, number][], mat: THREE.Material, segs = 48, phiStart = 0, phiLength = Math.PI * 2): THREE.Mesh {
  return new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs, phiStart, phiLength), mat);
}

/** Cylinder strut between two points. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, segs = 8): THREE.Mesh {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segs), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Planar decal (flag, markings) tangent to a cylinder of radius r at angle a. */
export function decal(w: number, h: number, tex: THREE.Texture, r: number, a: number, y: number, parent: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.5, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  m.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
  m.rotation.y = a;
  parent.add(m);
  return m;
}

/** Text decal canvas (transparent background). */
export function textCanvas(text: string, color: string, font = '700 150px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif', w = 1024, h = 256): THREE.Texture {
  const [c, ctx] = makeCanvas(w, h);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  return canvasTexture(c);
}

export function markShadows(o: THREE.Object3D, cast = true, receive = true): void {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
}

/** ShaderMaterial that behaves like an additive soft cone plume. */
export class Plume extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  /** `hollow` > 1 thins the middle of the flame, for the wide translucent exhaust of a vacuum engine. */
  constructor(color: THREE.Color, length = 10, radius = 2, segs = 40, core?: THREE.Color, hollow = 1) {
    const profile: THREE.Vector2[] = [];
    const N = 18;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      profile.push(new THREE.Vector2(radius * Math.pow(1 - t, 0.62) * (0.72 + 0.28 * Math.min(1, t * 7)) + 0.02, -t * length));
    }
    const g = new THREE.LatheGeometry(profile, segs);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color.clone() },
        uColor2: { value: core ?? new THREE.Color(1, 1, 1) },
        uIntensity: { value: 1 },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){ vT = clamp(-position.y / ${length.toFixed(2)}, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor, uColor2; uniform float uIntensity, uTime;
        varying float vT; varying vec3 vN; varying vec3 vV;
        void main(){
          float edge = clamp(abs(dot(normalize(vN + vec3(1e-6)), normalize(vV + vec3(1e-6)))), 0.0, 1.0);
          // MSAA edge fragments get varyings extrapolated past the geometry, so vT can exceed 1 here even
          // though the vertex shader clamps it: pow() of that negative base is NaN, and bloom smears one NaN
          // pixel over the whole frame. Every pow() base must be clamped in the fragment shader.
          float t = clamp(vT, 0.0, 1.0);
          float body = pow(edge, 0.9 * ${hollow.toFixed(2)}) * pow(1.0 - t, 1.4) * smoothstep(0.0, 0.06, t);
          float flick = 0.86 + 0.14 * sin(uTime * 37.0 + t * 22.0);
          vec3 col = mix(uColor2, uColor, smoothstep(0.0, 0.55, t));
          float a = body * uIntensity * flick;
          gl_FragColor = vec4(col * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    super(g, material);
    this.frustumCulled = false;
    this.renderOrder = 8;
    this.raycast = () => {};
  }
  set(intensity: number, time: number, scale = 1, width = 1): void {
    this.material.uniforms.uIntensity.value = intensity;
    this.material.uniforms.uTime.value = time;
    this.scale.set(width, scale, width);
    this.visible = intensity > 0.002;
  }
}
