import { orbitAngle, type MapPos, type MissionState } from '../core/missionState';
import { ACT_START, ACTS, type ActDef } from '../core/timeline';

const W = 520;
const H = 312;
const E = { x: 86, y: 178, r: 56 };
const M = { x: 438, y: 124, r: 23 };
const OR = 41; // lunar orbit radius on the map (not to scale)
const FONT = '"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
/** Label size on the 520 px wide canvas as designed; enlarged when the map is shown small. */
const BASE_FONT = 22;

type Pt = [number, number];
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Slot {
  box: Box;
  align: CanvasTextAlign;
  beside: boolean;
}

const ring = (deg: number): Pt => [M.x + OR * Math.cos((deg * Math.PI) / 180), M.y - OR * Math.sin((deg * Math.PI) / 180)];
const bez = (p: Pt[], t: number): Pt => {
  const u = 1 - t;
  const c = (k: number) => u * u * u * p[0][k] + 3 * u * u * t * p[1][k] + 3 * u * t * t * p[2][k] + t * t * t * p[3][k];
  return [c(0), c(1)];
};
const OUT1: Pt[] = [[128, 132], [214, 34], [330, 26], ring(138)];
const OUT2: Pt[] = [[124, 140], [224, 60], [338, 50], ring(154)];
const SITE: Pt = [128, 132];
const SEA: Pt = [116, 226];
/** The return arc starts wherever the ship is on its orbit when act 8 begins. */
const leaveDeg = (orbitAngle(ACT_START[8]) * 180) / Math.PI;
const HOME: Pt[] = [ring(leaveDeg), [300, 290], [190, 290], SEA];

const COLORS = { gold: '#f3c969', red: '#ff5a63', cyan: '#a9e4ff', dim: 'rgba(255,255,255,0.22)', text: '#dbe3ee' };

/** Position on the schematic map for a vehicle state. */
export function mapPoint(p: MapPos): Pt {
  switch (p.kind) {
    case 'earth':
      return [SITE[0] - p.lift * 5, SITE[1] - p.lift * 16];
    case 'outbound':
      return bez(OUT1, p.p);
    case 'home':
      return p.p >= 0.999 ? SEA : bez(HOME, p.p);
    case 'sea':
      return SEA;
    case 'orbit': {
      const a = p.a + p.drift;
      return [M.x + OR * Math.cos(a), M.y - OR * Math.sin(a)];
    }
    case 'surface': {
      const a = p.a * (180 / Math.PI);
      return [M.x + M.r * Math.cos((a * Math.PI) / 180), M.y - M.r * Math.sin((a * Math.PI) / 180)];
    }
    case 'landing': {
      const a = (p.a * 180) / Math.PI;
      const r = OR + (M.r - OR) * p.k;
      return [M.x + r * Math.cos((a * Math.PI) / 180), M.y - r * Math.sin((a * Math.PI) / 180)];
    }
    default: {
      const a = ((p.a + (p.target - p.a) * p.k) * 180) / Math.PI;
      const r = M.r + (OR - M.r) * p.k;
      return [M.x + r * Math.cos((a * Math.PI) / 180), M.y - r * Math.sin((a * Math.PI) / 180)];
    }
  }
}

/** Where the two vehicles are drawn. Docked vehicles are stacked a little so that both stay visible. */
export function mapVehicles(st: MissionState): { lander: Pt; ship: Pt } {
  const lp = mapPoint(st.lander);
  const sp = mapPoint(st.ship);
  const docked = Math.hypot(lp[0] - sp[0], lp[1] - sp[1]) < 1;
  return { lander: docked ? [lp[0], lp[1] + 9] : lp, ship: docked ? [sp[0], sp[1] - 9] : sp };
}

/** Captions and the fixed areas of the map, for a label size `f`. */
export function mapLayout(f: number): { cap: number; moonCap: Pt; earthCap: Pt; siteCap: Pt; earth: Box; moon: Box; moonText: Box; earthText: Box; siteText: Box } {
  const cap = Math.round(f * 0.9);
  // the "Moon" caption sits below its orbit, the "Earth" caption below the planet
  const moonCap: Pt = [M.x, M.y + OR + cap / 2 + 3];
  const earthCap: Pt = [E.x, E.y + E.r + cap / 2 + 6];
  // the launch site's caption sits above its marker, which climbs as the rocket clears the pad
  const siteCap: Pt = [SITE[0], SITE[1] - 10 - cap];
  // CJK glyphs are one em wide, so a caption of n characters covers n × cap
  const text = (at: Pt, chars: number): Box => ({ x0: at[0] - (chars * cap) / 2, y0: at[1] - cap / 2, x1: at[0] + (chars * cap) / 2, y1: at[1] + cap / 2 });
  return {
    cap,
    moonCap,
    earthCap,
    siteCap,
    earth: { x0: E.x - E.r, y0: E.y - E.r, x1: E.x + E.r, y1: E.y + E.r },
    moon: { x0: M.x - M.r - 2, y0: M.y - M.r - 2, x1: M.x + M.r + 2, y1: M.y + M.r + 2 },
    moonText: text(moonCap, 2),
    earthText: text(earthCap, 2),
    siteText: text(siteCap, 2),
  };
}

/** True while a vehicle marker is on top of a caption, which then fades so the marker stays readable. */
export const captionPasses = (vehicles: Pt[], caption: Pt, cap: number, r: number): boolean => vehicles.some((p) => Math.hypot(p[0] - caption[0], p[1] - caption[1]) < r + cap / 2);

/** Areas a vehicle label has to keep clear of: the bodies, and the captions that are not faded at this moment. */
export function reservedAreas(l: ReturnType<typeof mapLayout>, opts: { site: boolean; moonPass: boolean; sitePass: boolean }): Box[] {
  const boxes = [l.earth, l.moon];
  if (!opts.moonPass) boxes.push(l.moonText);
  boxes.push(l.earthText);
  if (opts.site && !opts.sitePass) boxes.push(l.siteText);
  return boxes;
}

/** Room a vehicle's name and crew dots need, and the marker scale that goes with label size `f`. */
export function labelSize(name: string, crew: number, f: number): { w: number; h: number; k: number } {
  // markers and dots grow with the label text, less than proportionally
  const k = Math.pow(f / BASE_FONT, 0.6);
  const w = Math.max(name.length * f, crew > 0 ? 8 * k + (crew - 1) * 10 * k : 0);
  return { w, h: f + (crew > 0 ? f * 0.7 : f * 0.2), k };
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 + 4 && a.x1 > b.x0 - 4 && a.y0 < b.y1 + 4 && a.y1 > b.y0 - 4;
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

/** First free slot for a label of size w × h around a marker at (x, y). When every slot is taken, the one with the least overlap. */
export function placeLabel(x: number, y: number, w: number, h: number, k: number, taken: Box[]): Slot & { free: boolean } {
  const beside = (dir: number, dy: number, dx: number): Slot => {
    const x0 = dir > 0 ? x + (15 + dx) * k : x - (15 + dx) * k - w;
    return { box: { x0, y0: y - h / 2 + dy, x1: x0 + w, y1: y + h / 2 + dy }, align: dir > 0 ? 'left' : 'right', beside: true };
  };
  const under = (dir: number, dx: number): Slot => ({
    box: { x0: x - w / 2 + dx, y0: dir > 0 ? y + 12 * k : y - 12 * k - h, x1: x + w / 2 + dx, y1: dir > 0 ? y + 12 * k + h : y - 12 * k },
    align: 'center',
    beside: false,
  });
  // nearest first: beside the marker, under or over it; then further out along the same row, or a row above or below
  const slots: Slot[] = [];
  const reach = [0, 24, 48, 72, 96, 120];
  [0, -(h + 2), h + 2, -(2 * h + 4), 2 * h + 4, -(3 * h + 6), 3 * h + 6, -(4 * h + 8), 4 * h + 8, -(5 * h + 10), 5 * h + 10].forEach((dy, i) => {
    reach.forEach((dx, j) => {
      slots.push(beside(1, dy, dx), beside(-1, dy, dx));
      if (i === 0 && j === 0) {
        const side = w / 2 + 10;
        slots.push(under(1, 0), under(-1, 0), under(1, side), under(1, -side), under(-1, side), under(-1, -side));
      }
    });
  });
  const inside = (b: Box) => b.x0 >= 2 && b.x1 <= W - 2 && b.y0 >= 2 && b.y1 <= H - 2;
  const free = slots.find((s) => inside(s.box) && !taken.some((t) => overlaps(s.box, t)));
  if (free) return { ...free, free: true };
  let best = slots[0];
  let cost = Infinity;
  for (const s of slots) {
    const c = taken.reduce((sum, t) => sum + overlapArea(s.box, t), 0) + (inside(s.box) ? 0 : 1e5);
    if (c < cost) {
      cost = c;
      best = s;
    }
  }
  return { ...best, free: false };
}

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private stars: [number, number, number][];
  private font = BASE_FONT;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.stars = Array.from({ length: 46 }, () => [rnd() * W, rnd() * H, 0.4 + rnd() * 1.1]);
  }

  setFont(px: number): void {
    this.font = px;
  }

  private path(p: Pt[], from: number, to: number): void {
    const c = this.ctx;
    const n = 36;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
      const q = bez(p, from + ((to - from) * i) / n);
      if (i === 0) c.moveTo(q[0], q[1]);
      else c.lineTo(q[0], q[1]);
    }
  }

  private route(p: Pt[], done: number, color: string, planned: number): void {
    const c = this.ctx;
    if (planned > 0) {
      c.setLineDash([5, 7]);
      c.strokeStyle = COLORS.dim;
      c.globalAlpha = planned;
      c.lineWidth = 1.5;
      this.path(p, Math.max(0, done - 0.001), 1);
      c.stroke();
      c.globalAlpha = 1;
      c.setLineDash([]);
    }
    if (done > 0.002) {
      c.strokeStyle = color;
      c.lineWidth = 3;
      c.shadowColor = color;
      c.shadowBlur = 9;
      this.path(p, 0, done);
      c.stroke();
      c.shadowBlur = 0;
    }
  }

  /** Marker with its name and crew dots. The label takes the first free slot around the marker, so vehicles that share an orbit never write over each other. */
  private vehicle(x: number, y: number, color: string, name: string, crew: number, active: boolean, T: number, taken: Box[]): void {
    const c = this.ctx;
    const f = this.font;
    const { w, h, k } = labelSize(name, crew, f);
    if (active) {
      const p = (T * 0.7) % 1;
      c.beginPath();
      c.arc(x, y, (8 + p * 13) * k, 0, Math.PI * 2);
      c.strokeStyle = color;
      c.globalAlpha = (1 - p) * 0.7;
      c.lineWidth = 2;
      c.stroke();
      c.globalAlpha = 1;
    }
    const pick = placeLabel(x, y, w, h, k, taken);
    const b = pick.box;
    taken.push({ x0: x - 11 * k, y0: y - 11 * k, x1: x + 11 * k, y1: y + 11 * k }, b);
    const nx = Math.min(b.x1, Math.max(b.x0, x));
    const ny = Math.min(b.y1, Math.max(b.y0, y));
    if (Math.hypot(nx - x, ny - y) > 16 * k) {
      // the label is not next to the marker any more: point at it
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(nx, ny);
      c.strokeStyle = color;
      c.globalAlpha = 0.55;
      c.lineWidth = 1.5;
      c.stroke();
      c.globalAlpha = 1;
    }
    c.beginPath();
    c.arc(x, y, 7.5 * k, 0, Math.PI * 2);
    c.fillStyle = '#070b14';
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = color;
    c.stroke();
    c.beginPath();
    c.arc(x, y, 3 * k, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.font = `600 ${f}px ${FONT}`;
    c.textAlign = pick.align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(name, pick.align === 'left' ? b.x0 : pick.align === 'right' ? b.x1 : b.x0 + w / 2, b.y0 + h / 2 - (crew > 0 ? f * 0.3 : 0));
    if (crew > 0) {
      const dot = 4 * k;
      const dw = 2 * dot + (crew - 1) * 10 * k;
      const dx = pick.align === 'left' ? b.x0 : pick.align === 'right' ? b.x1 - dw : b.x0 + (b.x1 - b.x0) / 2 - dw / 2;
      for (let i = 0; i < crew; i++) {
        c.beginPath();
        c.arc(dx + dot + i * 10 * k, b.y1 - f * 0.3, dot * 0.9, 0, Math.PI * 2);
        c.fillStyle = '#ffffff';
        c.fill();
      }
    }
  }

  draw(st: MissionState, act: ActDef, T: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, W, H);

    // stars
    for (const [x, y, r] of this.stars) {
      c.globalAlpha = 0.5;
      c.fillStyle = '#cfe3f5';
      c.fillRect(x, y, r, r);
    }
    c.globalAlpha = 1;

    // the plan, then what has been flown
    const landerOut = st.lander.kind === 'outbound' ? st.lander.p : T >= ACT_START[2] + ACTS[2].ev.orbit ? 1 : 0;
    const shipOut = st.ship.kind === 'outbound' ? st.ship.p : T >= ACT_START[4] ? 1 : 0;
    const home = st.ship.kind === 'home' ? st.ship.p : st.ship.kind === 'sea' ? 1 : 0;
    this.route(OUT1, landerOut, COLORS.gold, landerOut > 0 ? 0 : 0.75);
    this.route(OUT2, shipOut, COLORS.red, shipOut > 0 ? 0 : 0.75);
    this.route(HOME, home, COLORS.cyan, home > 0 ? 0 : 0.75);

    const { lander: lp, ship: sp } = mapVehicles(st);
    const l = mapLayout(this.font);
    const { cap, moonCap, earthCap, siteCap } = l;
    const siteShown = (act.id === 1 || act.id === 3) && T < ACT_START[act.id] + act.ev.liftoff + 3;
    const vehicles: Pt[] = [lp, sp];
    // a caption fades while a vehicle passes through it, and then no longer blocks a label
    const moonPass = captionPasses(vehicles, moonCap, cap, 30);
    const sitePass = siteShown && captionPasses(vehicles, siteCap, cap, 20);

    // Earth and Moon
    let g = c.createRadialGradient(E.x - 18, E.y - 20, 6, E.x, E.y, E.r);
    g.addColorStop(0, '#3f8fe0');
    g.addColorStop(0.6, '#16407f');
    g.addColorStop(1, '#0a1d44');
    c.beginPath();
    c.arc(E.x, E.y, E.r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = 'rgba(169,228,255,0.55)';
    c.stroke();
    // lunar orbit
    const orbitOn = T >= ACT_START[2] + ACTS[2].ev.orbit ? 1 : 0.3;
    c.beginPath();
    c.arc(M.x, M.y, OR, 0, Math.PI * 2);
    c.setLineDash([4, 6]);
    c.strokeStyle = `rgba(169,228,255,${0.75 * orbitOn})`;
    c.lineWidth = 1.5;
    c.stroke();
    c.setLineDash([]);
    g = c.createRadialGradient(M.x - 7, M.y - 8, 2, M.x, M.y, M.r);
    g.addColorStop(0, '#e4e1dc');
    g.addColorStop(0.7, '#9a9793');
    g.addColorStop(1, '#5d5b58');
    c.beginPath();
    c.arc(M.x, M.y, M.r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    for (const [dx, dy, r] of [[-7, -4, 4], [6, 6, 3], [3, -9, 2.2]]) {
      c.beginPath();
      c.arc(M.x + dx, M.y + dy, r, 0, Math.PI * 2);
      c.fillStyle = 'rgba(70,68,66,0.55)';
      c.fill();
    }
    c.font = `500 ${cap}px ${FONT}`;
    c.fillStyle = COLORS.text;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.globalAlpha = moonPass ? 0.18 : 1;
    c.fillText('月球', moonCap[0], moonCap[1]);
    c.globalAlpha = sitePass ? 0.18 : 1;
    if (siteShown) c.fillText('文昌', siteCap[0], siteCap[1]);
    c.globalAlpha = 1;
    c.fillText('地球', earthCap[0], earthCap[1]);

    // launch site before each lift-off
    if (siteShown) {
      const k = (T * 2) % 1;
      c.beginPath();
      c.arc(SITE[0], SITE[1], 5 + k * 9, 0, Math.PI * 2);
      c.strokeStyle = `rgba(232,50,60,${1 - k})`;
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = '#ff5a63';
      c.fillRect(SITE[0] - 3, SITE[1] - 3, 6, 6);
    }

    // vehicles
    const shipCrew = st.crew.filter((m) => m.place === 'ship' || m.place === 'capsule').length;
    const landerCrew = st.crew.filter((m) => m.place === 'lander' || m.place === 'moon').length;
    const landerActive = st.lander.kind !== 'earth' && st.ship.kind !== 'home' && st.ship.kind !== 'sea' && act.id !== 9;
    const shipActive = st.ship.kind !== 'earth' && act.id !== 9;
    const ascentOnly = T >= ACT_START[8];
    const taken: Box[] = reservedAreas(l, { site: siteShown, moonPass, sitePass });
    this.vehicle(lp[0], lp[1], COLORS.gold, ascentOnly ? '登月舱' : '揽月', landerCrew, landerActive, T, taken);
    if (st.ship.kind !== 'earth' || act.id >= 3) this.vehicle(sp[0], sp[1], COLORS.red, '梦舟', shipCrew, shipActive, T + 0.5, taken);
    if (st.ship.kind === 'sea') {
      const k = (T * 0.6) % 1;
      c.beginPath();
      c.arc(SEA[0], SEA[1], 8 + k * 16, 0, Math.PI * 2);
      c.strokeStyle = `rgba(169,228,255,${1 - k})`;
      c.lineWidth = 2;
      c.stroke();
    }
  }
}
