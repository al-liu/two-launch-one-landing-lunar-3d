import './style.css';
import { App } from './app/app';
import { AudioEngine } from './audio/engine';
import { EarthMoonStage } from './stages/earthmoon';
import { LaunchStage } from './stages/launch/launch';
import { OrbitStage } from './stages/orbit/orbit';
import { SurfaceStage } from './stages/surface/surface';
import { ReentryStage } from './stages/reentry/reentry';
import { buildAssets } from './stages/assets';
import type { Quality } from './stages/types';
import { Hud } from './ui/hud';

function detectQuality(): Quality {
  const q = new URLSearchParams(location.search).get('quality');
  const touch = navigator.maxTouchPoints > 0;
  const small = Math.min(screen.width, screen.height) <= 834;
  const mobile = q ? q === 'low' : touch && small;
  return { mobile, particles: mobile ? 0.45 : 1, textureScale: mobile ? 0.5 : 1 };
}

function boot(): void {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const quality = detectQuality();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, quality.mobile ? 1.5 : 2);
  const assets = buildAssets(quality);
  const app = new App(canvas, quality);
  app.addStage(new EarthMoonStage(assets, pixelRatio));
  app.addStage(new LaunchStage(assets, pixelRatio));
  app.addStage(new OrbitStage(assets, pixelRatio));
  app.addStage(new SurfaceStage(assets, pixelRatio, quality.mobile ? 60 : 110, quality.mobile ? 120 : 240));
  app.addStage(new ReentryStage(assets, pixelRatio));
  app.setPixelRatio(pixelRatio);
  const audio = new AudioEngine();
  const hud = new Hud(app, audio);
  app.onUpdate = (info) => hud.frame(info);

  // deep link: ?act=4&tl=12 jumps straight to a moment (used by the automated checks)
  const q = new URLSearchParams(location.search);
  const act = q.get('act');
  app.start(() => {
    app.seek(act !== null ? app.actStart(+act) + parseFloat(q.get('tl') ?? '0') : parseFloat(q.get('t') ?? '0') || 0);
    if (q.has('autoplay')) app.play();
    else app.pause();
    app.prewarm();
  });

  const dbg = {
    app,
    audio,
    get fps() {
      return app.fps;
    },
    get T() {
      return app.T;
    },
    seek: (t: number) => app.seek(t),
    play: () => app.play(),
    pause: () => app.pause(),
    /** Average milliseconds per rendered frame, GPU included (synchronous read-back). */
    bench: (n = 10) => {
      const gl = app.renderer.getContext() as WebGL2RenderingContext;
      const px = new Uint8Array(4);
      app.renderFrame(0.016);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) app.renderFrame(0.016);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return +((performance.now() - t0) / n).toFixed(2);
    },
  };
  (window as unknown as { lunar: typeof dbg }).lunar = dbg;
}

boot();
