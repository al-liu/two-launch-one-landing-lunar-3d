import { buildEarthMaps, type EarthMaps } from '../art/earthmap';
import { buildMoonGlobe, buildRegolith, type MoonGlobeMaps, type RegolithMaps } from '../art/moonmap';
import type { Quality } from './types';

/** Procedural textures generated once at start-up and shared by every stage. */
export interface Assets {
  quality: Quality;
  earth: EarthMaps;
  moon: MoonGlobeMaps;
  regolith: RegolithMaps;
}

export function buildAssets(quality: Quality): Assets {
  return {
    quality,
    earth: buildEarthMaps(),
    moon: buildMoonGlobe(quality.mobile ? 2048 : 4096),
    regolith: buildRegolith(quality.mobile ? 256 : 512),
  };
}
