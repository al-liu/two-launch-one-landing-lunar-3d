import * as THREE from 'three';
import type { ActDef } from '../core/timeline';

/** Director camera for one instant: position, look-at point, vertical field of view in degrees. */
export interface CamPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Screen-up direction in world space; stages tilt it to keep a banking subject upright. */
  up: THREE.Vector3;
}

export const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const newPose = (): CamPose => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, up: new THREE.Vector3(0, 1, 0) });

export interface Quality {
  mobile: boolean;
  /** Multiplier on particle counts and densities. */
  particles: number;
  textureScale: number;
}

/** A label or clickable hotspot attached to a point in the 3D scene. */
export interface Anchor {
  id: string;
  label: string;
  /** Info-card key; absent for plain labels. */
  part?: string;
  target: THREE.Object3D;
  local: THREE.Vector3;
  show: boolean;
}

export interface SoundParams {
  /** 0..1 engine / thruster level. */
  thrust: number;
  /** 0..1 air rushing past (atmosphere flight). */
  wind: number;
}

export interface StageCtx {
  act: ActDef;
  tl: number;
  aspect: number;
  quality: Quality;
  /** The viewer asked the system to reduce motion: skip shakes and other gratuitous movement. */
  reduced: boolean;
}

/**
 * A self-contained world at its own scale. Everything in it is a pure function of the act-local time,
 * so the timeline can be scrubbed forwards and backwards freely.
 */
export interface Stage {
  id: string;
  root: THREE.Group;
  near: number;
  far: number;
  /** Apply the state for this instant. */
  update(ctx: StageCtx): void;
  /** Director camera at act-local time tl. */
  camera(tl: number, out: CamPose): CamPose;
  /** World height the director camera must not drop below when a narrow window makes it back away from its subject. */
  camFloor?: number;
  /** Labels and hotspots valid for the current instant. The same array is reused. */
  anchors(): Anchor[];
  /** Objects that can be clicked or can hide a hotspot behind them (vehicles, pad). */
  pickRoots(): THREE.Object3D[];
  /** Optional picture-in-picture close-up at tl. */
  pip(tl: number, out: CamPose): CamPose | null;
  sound(tl: number): SoundParams;
  bloom(): { strength: number; threshold: number };
  /** Strength of the image-based light (regolith bounce under a black sky); 0 where the stage brings its own fill. */
  ambient?: number;
  dispose?(): void;
}

/** Which stage plays at a given moment of each act. Cuts between stages happen on these boundaries. */
export function stageFor(act: number, tl: number): string {
  switch (act) {
    case 0:
    case 9:
      return 'earthmoon';
    case 1:
    case 3:
      return 'launch';
    case 2:
      return tl < 8.5 ? 'earthmoon' : 'orbit';
    case 4:
      return 'orbit';
    case 5:
      return tl < 8 ? 'orbit' : 'surface';
    case 6:
      return 'surface';
    case 7:
      return tl < 12.5 ? 'surface' : 'orbit';
    default:
      return tl < 9 ? 'earthmoon' : 'reentry';
  }
}
