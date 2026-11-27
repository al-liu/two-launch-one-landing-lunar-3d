import * as THREE from 'three';
import { smoothstep } from '../core/easing';
import { fbm2, mulberry32 } from '../core/rand';
import { craterProfile, type RegolithMaps } from './moonmap';

const MOON_R = 1737400; // metres

export interface TerrainField {
  /** Height in metres at world xz (0 at the landing site). */
  height(x: number, z: number): number;
  /** Fresh, bright craters for albedo variation. */
  bright: { x: number; z: number; r: number }[];
}

interface Crater {
  x: number; z: number; r: number; depth: number;
}

/** Landing-site height field: rolling ground, craters, distant massifs, a flat pad around the origin. */
export function makeTerrain(seed = 7): TerrainField {
  const rnd = mulberry32(seed);
  const craters: Crater[] = [];
  for (let i = 0; i < 210; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 80 + Math.pow(rnd(), 0.7) * 1500;
    const r = 5 + 55 * Math.pow(rnd(), 2.4);
    craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r, depth: r * (0.14 + 0.06 * rnd()) });
  }
  const bright = craters.filter((_, i) => i % 9 === 0).map((c) => ({ x: c.x, z: c.z, r: c.r }));
  const massifs = Array.from({ length: 9 }, () => {
    const ang = rnd() * Math.PI * 2;
    const d = 3200 + rnd() * 3200;
    return { x: Math.cos(ang) * d, z: Math.sin(ang) * d, h: 260 + rnd() * 520, s: 500 + rnd() * 900 };
  });

  // spatial hash so each sample only visits nearby craters
  const CELL = 120;
  const grid = new Map<number, Crater[]>();
  const key = (i: number, j: number) => i * 73856093 + j * 19349663;
  for (const c of craters) {
    const e = c.r * 1.9;
    for (let i = Math.floor((c.x - e) / CELL); i <= Math.floor((c.x + e) / CELL); i++) {
      for (let j = Math.floor((c.z - e) / CELL); j <= Math.floor((c.z + e) / CELL); j++) {
        const k = key(i, j);
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(c);
      }
    }
  }

  const height = (x: number, z: number) => {
    let h = (fbm2(x * 0.0011 + 3.1, z * 0.0011 + 7.7, 5) - 0.5) * 90;
    h += (fbm2(x * 0.0062, z * 0.0062, 3) - 0.5) * 5.5;
    const list = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list) {
      for (const c of list) {
        const d = Math.hypot(x - c.x, z - c.z) / c.r;
        if (d < 1.9) h += craterProfile(d) * c.depth;
      }
    }
    for (const m of massifs) {
      const dd = Math.hypot(x - m.x, z - m.z) / m.s;
      if (dd < 3) h += m.h * Math.exp(-dd * dd) * (0.8 + 0.5 * fbm2(x * 0.002, z * 0.002, 2));
    }
    // keep the landing site perfectly flat
    return h * smoothstep(34, 80, Math.hypot(x, z));
  };
  return { height, bright };
}

export interface TerrainMesh {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

/** Polar grid: dense at the centre, sparse far away, following the Moon's curvature. */
export function buildTerrain(field: TerrainField, regolith: RegolithMaps, rings = 110, segments = 240, rMax = 9000): TerrainMesh {
  const pos = new Float32Array((rings + 1) * segments * 3);
  const uv = new Float32Array((rings + 1) * segments * 2);
  const col = new Float32Array((rings + 1) * segments * 3);
  const r0 = 1.6;
  const c = new THREE.Color();
  for (let k = 0; k <= rings; k++) {
    const r = r0 * Math.pow(rMax / r0, k / rings);
    const drop = (r * r) / (2 * MOON_R);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const i = (k * segments + s) * 3;
      const h = field.height(x, z);
      pos[i] = x;
      pos[i + 1] = h - drop;
      pos[i + 2] = z;
      uv[(k * segments + s) * 2] = x / 14;
      uv[(k * segments + s) * 2 + 1] = z / 14;
      // albedo variation: mottling, brighter ejecta around fresh craters, darker in bowls
      let v = 0.92 + 0.28 * fbm2(x * 0.013 + 11, z * 0.013, 3);
      v -= h * 0.0016;
      for (const b of field.bright) {
        const d = Math.hypot(x - b.x, z - b.z) / b.r;
        if (d < 2.2) v += 0.34 * (1 - smoothstep(0.9, 2.2, d));
      }
      const warm = 0.985 + 0.03 * fbm2(x * 0.002, z * 0.002, 2);
      c.setRGB(v * warm, v, v * (2 - warm) * 0.995);
      col[i] = c.r;
      col[i + 1] = c.g;
      col[i + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      const a = k * segments + s;
      const b = k * segments + s1;
      const cc = (k + 1) * segments + s;
      const d = (k + 1) * segments + s1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: regolith.albedo,
    normalMap: regolith.normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    // regolith is dark; left untinted it would blow out to white in direct sun
    color: new THREE.Color(0.56, 0.555, 0.55),
    roughness: 0.93,
    metalness: 0,
    vertexColors: true,
  });
  // Second, larger sample of the same crater field so metre-scale relief survives at distance.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        float cs = cos(0.7), sn = sin(0.7);
        vec2 duv = mat2(cs, -sn, sn, cs) * (vNormalMapUv * 0.43 - 0.5) + 0.5;
        vec3 dn = texture2D(normalMap, duv).xyz * 2.0 - 1.0;
        mat3 tbn2 = getTangentFrame(-vViewPosition, normal, duv);
        normal = normalize(tbn2 * vec3(dn.xy * 0.35, 1.0));
      }`,
    );
  };
  material.customProgramCacheKey = () => 'terrain-detail-v3';
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return { mesh, material };
}
