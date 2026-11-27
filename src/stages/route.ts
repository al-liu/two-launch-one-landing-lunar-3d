import * as THREE from 'three';

/**
 * Glowing trajectory tube. uv.x runs along the path, so the line can be revealed up to a progress
 * value, trimmed to a trailing tail, dashed, and carry a travelling pulse — all as pure functions of time.
 */
export class RouteLine extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  private curve: THREE.Curve<THREE.Vector3>;

  constructor(curve: THREE.Curve<THREE.Vector3>, color: THREE.Color, radius = 0.07, tubular = 180) {
    const g = new THREE.TubeGeometry(curve, tubular, radius, 8, false);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: color.clone() },
        uProgress: { value: 0 },
        uTail: { value: 0 },
        uDash: { value: 0 },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uPulse: { value: 0 },
        uSpeed: { value: 0.08 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uProgress, uTail, uDash, uTime, uOpacity, uPulse, uSpeed;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          float head = 1.0 - smoothstep(uProgress - 0.02, uProgress, vUv.x);
          float tail = smoothstep(uTail, uTail + 0.02, vUv.x);
          float dash = uDash > 0.0 ? 0.35 + 0.65 * step(0.45, fract(vUv.x * uDash - uTime * 0.5)) : 1.0;
          float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.3);
          float d = vUv.x - fract(uTime * uSpeed);
          float pulse = exp(-d * d * 900.0) * uPulse;
          vec3 col = uColor * (0.55 + 2.4 * pulse);
          float a = head * tail * dash * facing * uOpacity * (0.6 + 0.4 * pulse);
          gl_FragColor = vec4(col * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    super(g, material);
    this.curve = curve;
    this.frustumCulled = false;
    this.renderOrder = 6;
  }

  set(progress: number, opacity: number, time: number, dash = 0, pulse = 0): void {
    const u = this.material.uniforms;
    u.uProgress.value = progress;
    u.uOpacity.value = opacity;
    u.uTime.value = time;
    u.uDash.value = dash;
    u.uPulse.value = pulse;
    this.visible = opacity > 0.002 && progress > 0.002;
  }

  pointAt(p: number, out: THREE.Vector3): THREE.Vector3 {
    return this.curve.getPointAt(Math.min(1, Math.max(0, p)), out);
  }
}
