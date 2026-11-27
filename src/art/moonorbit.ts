import * as THREE from 'three';
import type { Assets } from '../stages/assets';

/**
 * The Moon seen from low orbit, shrunk so that real-scale vehicles can share the frame with its limb.
 * The globe map gives the large-scale maria and craters; two octaves of tileable regolith add relief
 * that would otherwise be far below one texel.
 */
export interface OrbitMoon {
  /** Place at the Moon's centre. */
  group: THREE.Group;
  uniforms: Record<string, THREE.IUniform>;
  /** Bring the texture point (lon, lat) to the top of the sphere. */
  face(lon: number, lat: number): void;
  /** Turn the globe about the world Z axis so the ground drifts under the vehicles. */
  spin(angle: number): void;
}

const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap, uNormal, uDetail, uDetailN;
uniform vec3 uSun;
uniform float uGain;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;

// Tangent frame from screen-space derivatives; columns fall back to fixed axes where they degenerate.
mat3 frame(vec3 N) {
  vec3 dx = dFdx(vW), dy = dFdy(vW);
  vec2 ux = dFdx(vUv), uy = dFdy(vUv);
  vec3 T = dx * uy.y - dy * ux.y;
  vec3 B = dy * ux.x - dx * uy.x;
  float lt = length(T), lb = length(B);
  return mat3(lt > 1e-12 ? T / lt : vec3(1.0, 0.0, 0.0), lb > 1e-12 ? B / lb : vec3(0.0, 0.0, 1.0), N);
}

void main() {
  vec3 N0 = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  mat3 F = frame(N0);
  float dist = length(cameraPosition - vW);
  vec3 nm = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
  vec2 uv1 = vUv * vec2(420.0, 210.0);
  vec2 uv2 = vUv * vec2(150.0, 75.0) + 0.37;
  vec3 n1 = texture2D(uDetailN, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uDetailN, uv2).xyz * 2.0 - 1.0;
  // the tiled octaves fall below a pixel at range: fade them before they start to shimmer
  float k1 = 1.0 - smoothstep(300.0, 1800.0, dist);
  float k2 = 1.0 - smoothstep(1500.0, 9000.0, dist);
  vec3 N = normalize(N0 + (F * vec3(nm.xy, 0.0)) * 0.5 + (F * vec3(n2.xy, 0.0)) * 0.3 * k2 + (F * vec3(n1.xy, 0.0)) * 0.22 * k1);

  vec3 alb = texture2D(uMap, vUv).rgb;
  alb *= 0.78 + 0.4 * texture2D(uDetail, uv2).r;

  // Lommel-Seeliger: the airless surface stays bright out to the limb instead of fading like a Lambert sphere
  float mu0 = max(dot(N, uSun), 0.0);
  float mu = max(dot(N, V), 0.0);
  float ls = min(2.0 * mu0 / (mu0 + mu + 0.02), 1.6);
  // relief too small to resolve is half shading, half flat: keeps crater rims from turning into black specks
  float m0 = max(dot(N0, uSun), 0.0);
  float m1 = max(dot(N0, V), 0.0);
  ls = mix(ls, min(2.0 * m0 / (m0 + m1 + 0.02), 1.6), 0.45);
  gl_FragColor = vec4(alb * ls * uGain, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function buildOrbitMoon(radius: number, assets: Assets): OrbitMoon {
  const uniforms: Record<string, THREE.IUniform> = {
    uMap: { value: assets.moon.albedo },
    uNormal: { value: assets.moon.normal },
    uDetail: { value: assets.regolith.albedo },
    uDetailN: { value: assets.regolith.normal },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uGain: { value: 1.6 },
  };
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 320, 200), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms }));
  mesh.frustumCulled = false;
  const tilt = new THREE.Object3D();
  tilt.add(mesh);
  const spinner = new THREE.Object3D();
  spinner.add(tilt);
  const group = new THREE.Group();
  group.add(spinner);
  const d = new THREE.Vector3();
  return {
    group,
    uniforms,
    face(lon, lat) {
      const phi = ((lon + 180) / 360) * Math.PI * 2;
      const theta = ((90 - lat) / 180) * Math.PI;
      d.set(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
      tilt.quaternion.setFromUnitVectors(d, new THREE.Vector3(0, 1, 0));
    },
    spin(angle) {
      spinner.rotation.z = angle;
    },
  };
}
