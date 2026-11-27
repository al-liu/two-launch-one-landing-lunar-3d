import * as THREE from 'three';
import { DEG } from '../core/easing';
import { mulberry32 } from '../core/rand';
import type { EarthMaps } from './earthmap';
import { glowCanvas } from './textures';
import { canvasTexture } from './textures';
import type { MoonGlobeMaps } from './moonmap';

/** Rotate a sphere so that the given longitude faces world azimuth `az` degrees (0 = +Z, towards the default camera). */
export function faceLongitude(obj: THREE.Object3D, lon: number, az = 0): void {
  obj.rotation.y = (az - (lon + 90)) * DEG;
}

const SURFACE_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const EARTH_FRAG = /* glsl */ `
uniform sampler2D uMap, uNoise, uNight;
uniform vec3 uSun;
uniform float uTime, uExposure, uNightLights;
varying vec3 vN; varying vec3 vW; varying vec2 vUv;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(N, uSun);
  float day = smoothstep(-0.06, 0.22, ndl);

  vec4 m = texture2D(uMap, vUv);
  vec2 cuv = vec2(vUv.x * 6.0, vUv.y * 3.0);
  float c1 = texture2D(uNoise, cuv + vec2(uTime * 0.0022, 0.0)).g;
  float c2 = texture2D(uNoise, cuv * 2.0 + vec2(-uTime * 0.0035, 0.37)).g;
  float c3 = texture2D(uNoise, vUv * vec2(14.0, 7.0) + vec2(uTime * 0.0011, 0.71)).b;
  float cover = smoothstep(0.40, 0.74, c3 * 0.72 + 0.28);
  float cloud = smoothstep(0.40, 0.88, c1 * 0.75 + c2 * 0.38) * (0.12 + 0.88 * cover);

  float lat = abs(vUv.y - 0.5) * 2.0;
  float detail = texture2D(uNoise, vUv * vec2(48.0, 24.0)).r;

  vec3 veg = vec3(0.050, 0.115, 0.030);
  vec3 dry = vec3(0.46, 0.35, 0.17);
  vec3 desert = vec3(0.80, 0.64, 0.40);
  vec3 tundra = vec3(0.26, 0.24, 0.19);
  vec3 land = veg * (0.65 + 1.0 * detail);
  land = mix(land, dry, smoothstep(0.22, 0.60, m.g) * 0.7);
  land = mix(land, desert, smoothstep(0.55, 0.95, m.g));
  land = mix(land, tundra, smoothstep(0.58, 0.90, lat));
  vec3 ocean = mix(vec3(0.008, 0.040, 0.135), vec3(0.016, 0.062, 0.135), smoothstep(0.3, 0.9, lat)) * (0.85 + 0.30 * detail);
  vec3 surf = mix(ocean, land, m.r);
  surf = mix(surf, vec3(0.84, 0.88, 0.93), m.b);

  float wrap = clamp(ndl * 0.94 + 0.06, 0.0, 1.0);
  vec3 col = surf * wrap * 1.1;

  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(N, H), 0.0), 260.0) * (1.0 - m.r) * (1.0 - m.b) * (1.0 - cloud);
  col += vec3(1.0, 0.86, 0.66) * spec * day * 2.4;

  vec3 cloudCol = vec3(0.045, 0.05, 0.07) + vec3(1.0) * 0.92 * smoothstep(-0.14, 0.36, ndl);
  col = mix(col, cloudCol, cloud * 0.93);

  float band = exp(-abs(ndl) * 15.0);
  col *= mix(vec3(1.0), vec3(1.28, 0.80, 0.56), band * 0.7);

  float lights = texture2D(uNight, vUv).r;
  float night = lights * (1.0 - day) * (1.0 - cloud * 0.85) * uNightLights;
  col += vec3(1.0, 0.70, 0.36) * night * 2.6;

  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.4);
  col += vec3(0.16, 0.38, 0.95) * rim * (0.30 + 1.0 * day);

  gl_FragColor = vec4(col * uExposure, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun, uColor, uCamPos;
uniform float uIntensity, uEdge;
varying vec3 vN; varying vec3 vW;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  float d = -dot(N, V);
  float ring = pow(clamp(d / uEdge, 0.0, 1.0), 1.6);
  float lit = smoothstep(-0.40, 0.45, dot(N, uSun));
  float a = ring * (0.10 + 1.35 * lit) * uIntensity;
  gl_FragColor = vec4(uColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Earth {
  group: THREE.Group;
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  setSun(dir: THREE.Vector3): void;
  update(time: number, camPos: THREE.Vector3): void;
}

export function buildEarth(radius: number, maps: EarthMaps): Earth {
  const uniforms: Record<string, THREE.IUniform> = {
    uMap: { value: maps.map },
    uNoise: { value: maps.noise },
    uNight: { value: maps.night },
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uNightLights: { value: 1 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    new THREE.ShaderMaterial({ vertexShader: SURFACE_VERT, fragmentShader: EARTH_FRAG, uniforms }),
  );
  const atmoU: Record<string, THREE.IUniform> = {
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uColor: { value: new THREE.Color(0.30, 0.56, 1.0) },
    uCamPos: { value: new THREE.Vector3() },
    uIntensity: { value: 1.25 },
    uEdge: { value: 0.215 },
  };
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.025, 96, 64),
    new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: atmoU,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  atmo.renderOrder = 5;
  const group = new THREE.Group();
  group.add(mesh, atmo);
  return {
    group,
    mesh,
    uniforms,
    setSun(dir) {
      (uniforms.uSun.value as THREE.Vector3).copy(dir);
      (atmoU.uSun.value as THREE.Vector3).copy(dir);
    },
    update(time, camPos) {
      uniforms.uTime.value = time;
      (atmoU.uCamPos.value as THREE.Vector3).copy(camPos);
    },
  };
}

/** Three brightness classes of stars, fixed to the camera. */
export class Stars extends THREE.Group {
  private mats: THREE.ShaderMaterial[] = [];
  constructor(radius: number, pixelRatio: number) {
    super();
    const rnd = mulberry32(2024);
    const classes: [number, number, number][] = [
      [5200, 1.25, 0.55],
      [1300, 2.1, 1.0],
      [170, 3.6, 2.6],
    ];
    for (const [count, size, bright] of classes) {
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        // uniform on the sphere
        const z = rnd() * 2 - 1;
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(1 - z * z);
        pos[i * 3] = Math.cos(a) * r * radius;
        pos[i * 3 + 1] = z * radius;
        pos[i * 3 + 2] = Math.sin(a) * r * radius;
        const t = rnd();
        const c = new THREE.Color().setRGB(0.72 + 0.28 * t, 0.80 + 0.14 * t, 1.0 - 0.32 * t * t).multiplyScalar(bright * (0.5 + 0.5 * rnd()));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uScale: { value: pixelRatio }, uOpacity: { value: 1 }, uSize: { value: size } },
        vertexShader: /* glsl */ `
          attribute vec3 aColor; uniform float uScale, uSize; varying vec3 vC;
          void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * uScale; }`,
        fragmentShader: /* glsl */ `
          uniform float uOpacity; varying vec3 vC;
          void main(){ vec2 d = gl_PointCoord * 2.0 - 1.0; float r = dot(d, d); if (r > 1.0) discard; float a = exp(-r * 3.4) * (1.0 - r);
            gl_FragColor = vec4(vC * a * uOpacity, a * uOpacity);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      const pts = new THREE.Points(g, mat);
      pts.frustumCulled = false;
      pts.renderOrder = -10;
      this.add(pts);
      this.mats.push(mat);
    }
  }
  setOpacity(k: number): void {
    for (const m of this.mats) m.uniforms.uOpacity.value = k;
  }
  setPixelRatio(k: number): void {
    for (const m of this.mats) m.uniforms.uScale.value = k;
  }
}

/** Sun: a hot core plus a wide glare, both additive sprites that feed the bloom pass. */
export class SunGlow extends THREE.Group {
  private glare: THREE.Sprite;
  private core: THREE.Sprite;
  constructor() {
    super();
    const tex = canvasTexture(glowCanvas(256, '#ffffff', 3));
    const mk = (scale: number, color: THREE.Color, intensity: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: color.clone().multiplyScalar(intensity), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(scale);
      this.add(s);
      return s;
    };
    this.glare = mk(1, new THREE.Color(1.0, 0.78, 0.52), 1.6);
    this.core = mk(0.16, new THREE.Color(1.0, 0.96, 0.9), 9);
  }
  /** Place the sun along dir at distance d; size scales with d so it looks the same from anywhere. */
  place(dir: THREE.Vector3, d: number): void {
    this.position.copy(dir).multiplyScalar(d);
    this.glare.scale.setScalar(d * 0.16);
    this.core.scale.setScalar(d * 0.026);
    this.visible = true;
  }
}

export function buildMoonGlobe(radius: number, maps: MoonGlobeMaps): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ map: maps.albedo, normalMap: maps.normal, roughness: 0.96, metalness: 0, normalScale: new THREE.Vector2(1.1, 1.1) });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 96, 64), mat);
  faceLongitude(mesh, 0);
  return mesh;
}
