import * as THREE from 'three';
import { fbm2, mulberry32 } from '../../core/rand';
import { Stars } from '../../art/planet';
import { markShadows } from '../../art/geo';

/** Visual planet radius (metres). Compressed so the curvature shows within a few kilometres of altitude. */
const RP = 160000;
// Keep far geometry well inside the far plane: post-processing targets have less depth precision than the canvas.
const OCEAN_R = 30000;
const DOME_R = 40000;

/** Shared by the sky dome and the ocean so the horizon line is seamless. */
const SKY_FN = /* glsl */ `
const float RP = ${RP.toFixed(1)};
uniform vec3 uSunDir;
uniform float uAlt;
uniform float uA;
uniform float uTime;
vec3 horizonTint(vec3 d) {
  vec2 dh = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  // clamp: pow() of a tiny negative base (float error) would yield NaN, and bloom would smear it over the frame
  float side = clamp(dot(dh, sh) * 0.5 + 0.5, 0.0, 1.0);
  return mix(vec3(0.25, 0.31, 0.58), vec3(1.0, 0.43, 0.21), pow(side, 3.2));
}
vec3 skyColor(vec3 d) {
  float e = asin(clamp(d.y, -1.0, 1.0));
  float dip = acos(clamp(RP / (RP + uAlt), -1.0, 1.0));
  float hzn = e + dip;
  float t = clamp(e * 1.6, 0.0, 1.0);
  vec3 low = mix(horizonTint(d), vec3(0.030, 0.062, 0.21), pow(t, 0.42));
  float sd = max(dot(d, uSunDir), 0.0);
  low += vec3(1.0, 0.56, 0.26) * pow(sd, 5.0) * 0.6 * (1.0 - t * 0.6);
  float w = mix(0.30, 0.014, smoothstep(0.0, 1.0, uA));
  float band = exp(-max(hzn, 0.0) / w) * 0.75 + exp(-max(hzn, 0.0) / (w * 6.0)) * 0.32;
  vec3 hi = vec3(0.30, 0.58, 1.0) * band * 1.5 + vec3(1.0, 0.78, 0.55) * pow(sd, 8.0) * 0.6 * (0.3 + band);
  float k = smoothstep(0.0, 1.0, uA);
  return mix(low, hi, k);
}
`;

/** Polar disc that follows the planet's curvature: dense near the pad, sparse at the horizon. */
function polarDisc(r0: number, r1: number, rings: number, segments: number, extraHeight?: (x: number, z: number) => number): THREE.BufferGeometry {
  const pos = new Float32Array((rings + 1) * segments * 3);
  const rad = new Float32Array((rings + 1) * segments);
  for (let k = 0; k <= rings; k++) {
    const r = r0 * Math.pow(r1 / r0, k / rings);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const i = k * segments + s;
      pos[i * 3] = x;
      pos[i * 3 + 1] = -(r * r) / (2 * RP) + (extraHeight ? extraHeight(x, z) : 0);
      pos[i * 3 + 2] = z;
      rad[i] = r;
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      const a = k * segments + s;
      const b = k * segments + s1;
      const c = (k + 1) * segments + s;
      const d = (k + 1) * segments + s1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(rad, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface LaunchEnv {
  group: THREE.Group;
  sunDir: THREE.Vector3;
  /** alt: metres above the pad; a: 0 at the ground, 1 in space. */
  setAltitude(alt: number, a: number, camPos: THREE.Vector3): void;
  setTime(t: number): void;
}

/** Dusk sky over the sea at Wenchang that turns into space as the camera climbs. */
export function buildLaunchEnv(pixelRatio: number, withLand = true): LaunchEnv {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(0.74, 0.17, 0.4).normalize();
  const shared = {
    uSunDir: { value: sunDir },
    uAlt: { value: 0 },
    uA: { value: 0 },
    uTime: { value: 0 },
  };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_R, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { ...shared },
      vertexShader: /* glsl */ `
        varying vec3 vD;
        void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vD;
        ${SKY_FN}
        void main(){
          vec3 col = skyColor(normalize(vD));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  group.add(dome);
  const stars = new Stars(DOME_R * 0.94, pixelRatio);
  dome.add(stars);

  const ocean = new THREE.Mesh(
    polarDisc(14, OCEAN_R, 64, 180),
    new THREE.ShaderMaterial({
      uniforms: { ...shared },
      vertexShader: /* glsl */ `
        attribute float aR; varying float vR; varying vec3 vW;
        void main(){ vR = aR; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        varying float vR; varying vec3 vW;
        ${SKY_FN}
        void main(){
          vec3 toCam = cameraPosition - vW;
          float dist = length(toCam);
          vec3 V = toCam / dist;
          vec3 deep = vec3(0.010, 0.040, 0.105);
          vec3 shallow = vec3(0.030, 0.15, 0.19);
          vec3 col = mix(shallow, deep, smoothstep(2300.0, 4300.0, vR));
          vec3 N = normalize(vec3(0.0, 1.0, 0.0) + vec3(sin(vW.x * 0.021 + uTime * 0.7) * 0.035, 0.0, cos(vW.z * 0.017 + uTime * 0.6) * 0.035));
          float spec = pow(max(dot(reflect(-uSunDir, N), V), 0.0), 120.0);
          col += vec3(1.0, 0.62, 0.30) * spec * 1.5;
          col *= mix(1.0, 0.45, uA);
          float fog = 1.0 - exp(-dist / mix(7000.0, 70000.0, uA));
          vec3 d = normalize(vW - cameraPosition);
          col = mix(col, skyColor(d), fog);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  ocean.frustumCulled = false;
  group.add(ocean);

  // ---- coastal land: a low plateau with the pad, falling to a wavy shoreline ~1.3 km towards the sea (+Z)
  const SIZE = 9000;
  const coastR = (a: number) => 1250 + 520 * (fbm2(Math.cos(a) * 2.3 + 9, Math.sin(a) * 2.3 + 4, 3) - 0.5) * 2;
  const landH = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const c = coastR(a);
    const sea = 1 - Math.min(1, Math.max(0, (c - r) / 260));
    const base = 6.5 + 5 * (fbm2(x * 0.0012 + 3, z * 0.0012, 4) - 0.5) * 2 * Math.min(1, r / 500);
    const pad = Math.min(1, Math.max(0, (r - 420) / 300));
    return (6.2 + (base - 6.2) * pad) * (1 - sea) - 9 * sea;
  };
  const land = new THREE.PlaneGeometry(SIZE, SIZE, 150, 150);
  land.rotateX(-Math.PI / 2);
  const lp = land.attributes.position as THREE.BufferAttribute;
  const lc = new Float32Array(lp.count * 3);
  const rnd = mulberry32(31);
  const green = new THREE.Color(0x3f6a2e);
  const dark = new THREE.Color(0x27451f);
  const sand = new THREE.Color(0xcdbb93);
  const rock = new THREE.Color(0x6f7276);
  const tmp = new THREE.Color();
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i);
    const z = lp.getZ(i);
    const r = Math.hypot(x, z);
    const h = landH(x, z);
    lp.setY(i, h - (r * r) / (2 * RP));
    const c = coastR(Math.atan2(z, x));
    const beach = 1 - Math.min(1, Math.max(0, (c - r - 40) / 70));
    tmp.copy(green).lerp(dark, fbm2(x * 0.004, z * 0.004, 3));
    if (r < 330) tmp.copy(rock).multiplyScalar(0.8 + 0.2 * rnd());
    if (beach > 0) tmp.lerp(sand, beach);
    if (h < -0.5) tmp.multiplyScalar(0.5);
    lc[i * 3] = tmp.r;
    lc[i * 3 + 1] = tmp.g;
    lc[i * 3 + 2] = tmp.b;
  }
  land.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  land.computeVertexNormals();
  const landMesh = new THREE.Mesh(land, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
  landMesh.receiveShadow = true;
  landMesh.position.y = 0.02;
  group.add(landMesh);
  markShadows(landMesh, false, true);
  landMesh.visible = withLand;

  return {
    group,
    sunDir,
    setAltitude(alt, a, camPos) {
      shared.uAlt.value = alt;
      shared.uA.value = a;
      dome.position.copy(camPos);
      stars.setOpacity(Math.min(1, Math.max(0, (a - 0.28) / 0.4)));
    },
    setTime(t) {
      shared.uTime.value = t;
    },
  };
}
