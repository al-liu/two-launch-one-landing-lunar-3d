import { clamp } from './easing';

export interface Cue {
  t: number;
  d: number;
  text: string;
}

export interface ActDef {
  id: number;
  name: string;
  short: string;
  duration: number;
  cues: Cue[];
  why: string;
  /** Named event times (seconds from act start). Stages read these so picture, panel and scrub marks stay in sync. */
  ev: Record<string, number>;
}

export const ACTS: ActDef[] = [
  {
    id: 0,
    name: '序章',
    short: '序章',
    duration: 22,
    cues: [
      { t: 1.2, d: 4.6, text: '2030 年前，中国人将首次登陆月球。' },
      { t: 6.4, d: 4.8, text: '开展月球科学考察及相关技术试验。' },
      { t: 12, d: 9, text: '一次登月任务，需要两枚长征十号火箭——它们分别送什么上去？' },
    ],
    why: '量力而行：方案与我国现有技术能力和设施手段相匹配，单枚火箭只托举两者之一，无须一次性将飞船和着陆器同时送往月球。',
    ev: { title: 2.5, pull: 5, pullEnd: 14, route: 15, routeEnd: 20.5 },
  },
  {
    id: 1,
    name: '第一次发射 · 揽月',
    short: '一发射',
    duration: 32,
    cues: [
      { t: 0.6, d: 4.2, text: '海南文昌航天发射场。' },
      { t: 5.4, d: 7.6, text: '长征十号点火升空：全长约 92.5 米，起飞质量约 2189 吨。' },
      { t: 13.6, d: 7.4, text: '起飞推力约 2678 吨，地月转移轨道运载能力不低于 27 吨。' },
      { t: 21.6, d: 9.4, text: '第一次发射，送的是无人着陆器——揽月。' },
    ],
    why: '量力而行：单枚火箭只需托举两者之一，无须一次性将飞船和着陆器同时送往月球。',
    ev: { ignite: 4.6, liftoff: 6.4, towerClear: 9.5, boostSep: 17, stageSep: 23, fairing: 26.5 },
  },
  {
    id: 2,
    name: '奔月 · 停泊',
    short: '奔月',
    duration: 28,
    cues: [
      { t: 0.6, d: 7.4, text: '揽月沿地月转移轨道飞向月球。' },
      { t: 9, d: 7.6, text: '到达月球附近，推进舱点火减速——近月制动。' },
      { t: 17.6, d: 9.4, text: '进入环月轨道，停泊等待。' },
    ],
    why: '轻装登月：飞船和着陆器各司其职，揽月只负责环月轨道与月面之间的往返。',
    ev: { burn: 9.5, burnEnd: 16.5, orbit: 18, wideEnd: 8.5 },
  },
  {
    id: 3,
    name: '第二次发射 · 梦舟',
    short: '二发射',
    duration: 26,
    cues: [
      { t: 0.6, d: 4.2, text: '第二次发射，同样从文昌出发。' },
      { t: 5.4, d: 8, text: '这一次，长征十号托举的是载有 3 名航天员的梦舟飞船。' },
      { t: 14, d: 10.6, text: '发射段顶部有逃逸塔——由飞船承担逃逸救生任务。' },
    ],
    why: '安全兜底：发射阶段有逃逸救生系统；先无人后载人、先近地后月球。',
    ev: { ignite: 4.6, liftoff: 6.4, towerClear: 9.5, boostSep: 21.5, tli: 19 },
  },
  {
    id: 4,
    name: '月轨握手',
    short: '对接',
    duration: 34,
    cues: [
      { t: 0.6, d: 7.2, text: '梦舟进入环月轨道，寻找先期到达的揽月。' },
      { t: 8.4, d: 8, text: '第 1 次对接：逼近、缓靠、锁紧。' },
      { t: 17.2, d: 7.8, text: '换乘：2 名航天员从梦舟进入揽月。' },
      { t: 25.6, d: 7.6, text: '第 3 名航天员留在梦舟，继续环月飞行待命。' },
    ],
    why: '轻装登月：用于返回地球的返回舱、服务舱留在环月轨道待命，不必跟随落到月面再抬起来。',
    ev: { contact: 13.4, lock: 14.6, hatch: 18, transfer: 19.5, transferEnd: 24.5, wideEnd: 8.5 },
  },
  {
    id: 5,
    name: '分离 · 落月',
    short: '落月',
    duration: 30,
    cues: [
      { t: 0.6, d: 5.6, text: '揽月与梦舟分离。' },
      { t: 6.8, d: 7.6, text: '推进舱点火减速下降——下降的主减速由推进舱负责。' },
      { t: 15, d: 7, text: '月面越来越近……' },
      { t: 22.6, d: 6.8, text: '着陆腿触月，软着陆于月面预定区域。' },
    ],
    why: '分工明确：揽月负责环月轨道与月面之间的往返运输，可搭载 2 名航天员，可携带月球车和科学载荷。',
    ev: { undock: 1.2, turn: 3, burn: 6.2, cut: 8, touch: 23.2 },
  },
  {
    id: 6,
    name: '月面作业',
    short: '月面',
    duration: 36,
    cues: [
      { t: 0.6, d: 6.4, text: '黑色的天空中，悬挂着地球。' },
      { t: 7.6, d: 7, text: '航天员穿"望宇"登月服出舱活动。' },
      { t: 15.2, d: 9, text: '驾驶"探索"载人月球车，开展科学考察、样品采集与试验。' },
      { t: 25, d: 10, text: '揽月，是这里的月面生活中心、能源中心和数据中心。' },
    ],
    why: '技术传承：嫦娥五号、嫦娥六号已走通"月面起飞—月球轨道交会对接—样品转移—高速再入返回"全流程。',
    ev: { hatch: 7.8, egress: 9, egressEnd: 14.5, rover: 15, driveEnd: 25, sample: 26, sampleEnd: 31, earthEnd: 8 },
  },
  {
    id: 7,
    name: '起飞 · 再握手',
    short: '起飞',
    duration: 32,
    cues: [
      { t: 0.6, d: 6.4, text: '登月舱点火，2 名航天员从月面起飞，进入环月轨道。' },
      { t: 7.6, d: 5.2, text: '推进舱留在月面。' },
      { t: 13.4, d: 7, text: '第 2 次对接：登月舱与梦舟再次交会对接。' },
      { t: 21.2, d: 9.6, text: '航天员携月球样品进入梦舟，3 人会合。' },
    ],
    why: '系列化：飞船和着陆器分开研制，有利于标准化，形成长期使用的系列型谱。',
    ev: { ignite: 3.4, liftoff: 4.2, cut: 12.5, contact: 18.8, lock: 19.8, transfer: 22.6, transferEnd: 27 },
  },
  {
    id: 8,
    name: '归途',
    short: '归途',
    duration: 34,
    cues: [
      { t: 0.6, d: 7.6, text: '梦舟与揽月登月舱分离，脱离环月轨道，沿月地转移轨道返回地球。' },
      { t: 9, d: 5.8, text: '接近地球时，返回舱与服务舱分离。' },
      { t: 15.4, d: 8.2, text: '返回舱以接近第二宇宙速度（11.2 千米/秒）再入大气层。' },
      { t: 24.4, d: 8.6, text: '开伞，海上溅落。返回舱承担再入大气层与着陆任务，可重复使用。' },
    ],
    why: '分工明确：梦舟只负责地球与环月轨道之间的往返；返回舱是航天员的座舱和控制中枢。',
    ev: { sep: 10.2, cut: 9, reentry: 15.6, reentryEnd: 23, chute: 23.8, chuteFull: 25.4, splash: 30.4 },
  },
  {
    id: 9,
    name: '尾声',
    short: '尾声',
    duration: 30,
    cues: [
      { t: 0.6, d: 6.6, text: '两次发射，环月对接：一艘飞船、一艘着陆器，各司其职。' },
      { t: 8, d: 7.6, text: '从逃逸试验到着陆起飞验证、火箭首飞，工程稳步推进。' },
      { t: 16.4, d: 7, text: '下一步：无人飞行试验 → 首飞 → 载人登月。' },
      { t: 24, d: 5.6, text: '2030 年前，中国人登陆月球。' },
    ],
    why: '量力而行、轻装登月、安全兜底——与我国现有技术能力和设施手段相匹配的登月方案。',
    ev: { route: 0.6, routeEnd: 7.5, nodeEnd: 19, close: 24 },
  },
];

export const ACT_START: number[] = [];
export const TOTAL = ACTS.reduce((s, a) => {
  ACT_START.push(s);
  return s + a.duration;
}, 0);

export interface Location {
  act: number;
  /** Act-local time. */
  tl: number;
  /** 0..1 progress inside the act. */
  u: number;
  /** Global time. */
  T: number;
}

export function locate(T: number): Location {
  const t = clamp(T, 0, TOTAL - 1e-6);
  let act = ACTS.length - 1;
  for (let i = 0; i < ACTS.length; i++) {
    if (t < ACT_START[i] + ACTS[i].duration) {
      act = i;
      break;
    }
  }
  const tl = t - ACT_START[act];
  return { act, tl, u: tl / ACTS[act].duration, T: t };
}

export const actTime = (act: number, tl: number) => ACT_START[act] + tl;

export function cueAt(act: number, tl: number): Cue | null {
  for (const c of ACTS[act].cues) if (tl >= c.t && tl < c.t + c.d) return c;
  return null;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
