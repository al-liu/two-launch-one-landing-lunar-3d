import * as THREE from 'three';
import { clamp, easeInOutCubic } from '../core/easing';
import { WORLD_UP, type CamPose } from '../stages/types';

const IDLE = 3.5; // seconds without input before drifting back to the director

/**
 * Combines the director camera with the viewer's own orbit.
 * Drag = rotate around the director's focus point, wheel / pinch = dolly. After a few idle seconds
 * the view eases back to whatever the director is doing now.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0;
  zoom = 1;
  /** 0 = director, 1 = fully free. */
  blend = 0;
  private lastInput = -1e9;
  private sp = new THREE.Spherical();
  private off = new THREE.Vector3();
  private onReturn: (() => void) | null = null;

  get free(): boolean {
    return this.blend > 0.001;
  }

  /** User started interacting. */
  touch(): void {
    this.lastInput = performance.now() / 1000;
  }

  get idle(): boolean {
    return performance.now() / 1000 - this.lastInput > IDLE;
  }

  rotate(dx: number, dy: number): void {
    this.touch();
    this.yaw -= dx;
    this.pitch = clamp(this.pitch + dy, -1.35, 1.35);
  }

  dolly(factor: number): void {
    this.touch();
    this.zoom = clamp(this.zoom * factor, 0.1, 6);
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1;
    this.lastInput = -1e9;
  }

  onReturned(fn: () => void): void {
    this.onReturn = fn;
  }

  apply(pose: CamPose, dt: number, cam: THREE.PerspectiveCamera, minDist: number): void {
    // taking control is quick; letting go settles back on a fixed clock so the button disappears on time
    const before = this.blend;
    if (this.idle) this.blend = Math.max(0, this.blend - dt / 0.9);
    else this.blend += (1 - this.blend) * (1 - Math.exp(-dt / 0.08));
    if (this.idle && before > 0.001 && this.blend <= 0.001) {
      this.blend = 0;
      this.yaw = 0;
      this.pitch = 0;
      this.zoom = 1;
      this.onReturn?.();
    }
    const e = easeInOutCubic(this.blend);
    this.off.subVectors(pose.pos, pose.look);
    this.sp.setFromVector3(this.off);
    this.sp.theta += this.yaw * e;
    this.sp.phi = clamp(this.sp.phi - this.pitch * e, 0.04, Math.PI - 0.04);
    this.sp.radius = Math.max(minDist, this.sp.radius * Math.exp(Math.log(this.zoom) * e));
    this.off.setFromSpherical(this.sp);
    cam.position.copy(pose.look).add(this.off);
    cam.up.lerpVectors(pose.up, WORLD_UP, e);
    cam.lookAt(pose.look);
    if (Math.abs(cam.fov - pose.fov) > 1e-3) {
      cam.fov = pose.fov;
      cam.updateProjectionMatrix();
    }
  }
}
