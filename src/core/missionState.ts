import { easeInOutSine, seg, smoothstep } from './easing';
import { ACTS, ACT_START, TOTAL, actTime } from './timeline';

export type CrewPlace = 'earth' | 'ship' | 'lander' | 'moon' | 'capsule';
export type SampleState = 'none' | 'collected' | 'transferred' | 'returned';

export type MapPos =
  | { kind: 'earth'; lift: number }
  | { kind: 'outbound'; p: number }
  | { kind: 'orbit'; a: number; drift: number }
  | { kind: 'landing'; a: number; k: number }
  | { kind: 'ascending'; a: number; target: number; k: number }
  | { kind: 'surface'; a: number }
  | { kind: 'home'; p: number }
  | { kind: 'sea' };

export interface CrewMember {
  place: CrewPlace;
  /** 0..1 while moving between vehicles, -1 otherwise. */
  moving: number;
}

export interface MissionState {
  launches: number;
  dockings: number;
  orbitCrew: number;
  moonCrew: number;
  crew: CrewMember[];
  sample: SampleState;
  phase: string;
  lander: MapPos;
  ship: MapPos;
  /** The ascent stage once it has been left behind. */
  ascent: MapPos | null;
}

const E = (act: number, key: string) => actTime(act, ACTS[act].ev[key]);

const T_LIFT_1 = E(1, 'liftoff');
const T_BURN = E(2, 'burn');
const T_ORBIT = E(2, 'orbit');
const T_LIFT_2 = E(3, 'liftoff');
const T_TLI = E(3, 'tli');
const T_CONTACT_1 = E(4, 'contact');
const T_LOCK_1 = E(4, 'lock');
const T_TR_1 = E(4, 'transfer');
const T_DEORB = E(5, 'burn');
const T_TOUCH = E(5, 'touch');
const T_LIFT_3 = E(7, 'liftoff');
const T_CONTACT_2 = E(7, 'contact');
const T_LOCK_2 = E(7, 'lock');
const T_TR_2 = E(7, 'transfer');
const T_TR_2_END = E(7, 'transferEnd');
const T_SEP = E(8, 'sep');
const T_REENTRY = E(8, 'reentry');
const T_SPLASH = E(8, 'splash');

const SHIP_ORBIT_IN = actTime(4, 2);
const ORBIT_RATE = 0.11;

/** Angle (radians) on the schematic lunar orbit at global time t. */
export const orbitAngle = (t: number) => 2.35 + ORBIT_RATE * (t - T_ORBIT);
const theta = orbitAngle;

export function missionState(Tin: number): MissionState {
  const T = Math.max(0, Math.min(Tin, TOTAL));
  const A = ACT_START;

  let lander: MapPos;
  let ascent: MapPos | null = null;
  if (T < A[2]) {
    lander = { kind: 'earth', lift: seg(T, T_LIFT_1, T_LIFT_1 + 6) };
  } else if (T < T_ORBIT) {
    const tl = T - A[2];
    // 80% of the way during the wide transfer shot, the rest during the braking burn
    lander = { kind: 'outbound', p: 0.8 * easeInOutSine(seg(tl, 0, E(2, 'wideEnd') - A[2])) + 0.2 * seg(tl, E(2, 'wideEnd') - A[2], T_ORBIT - A[2]) };
  } else if (T < T_DEORB) {
    lander = { kind: 'orbit', a: theta(T), drift: 0 };
  } else if (T < T_TOUCH) {
    lander = { kind: 'landing', a: theta(T_DEORB), k: easeInOutSine(seg(T, T_DEORB, T_TOUCH)) };
  } else if (T < T_LIFT_3) {
    lander = { kind: 'surface', a: theta(T_DEORB) };
  } else if (T < T_LOCK_2) {
    lander = { kind: 'ascending', a: theta(T_DEORB), target: theta(T_CONTACT_2), k: easeInOutSine(seg(T, T_LIFT_3, T_CONTACT_2)) };
  } else if (T < T_SEP) {
    lander = { kind: 'orbit', a: theta(T), drift: 0 };
  } else {
    ascent = { kind: 'orbit', a: theta(T), drift: 0.18 * smoothstep(T_SEP, T_REENTRY, T) };
    lander = ascent;
  }

  let ship: MapPos = { kind: 'earth', lift: 0 };
  if (T >= T_LIFT_2 && T < SHIP_ORBIT_IN) {
    ship = { kind: 'outbound', p: easeInOutSine(seg(T, T_TLI, SHIP_ORBIT_IN - 2)) };
  } else if (T >= SHIP_ORBIT_IN && T < A[8]) {
    const a = T < T_CONTACT_1 ? theta(T) - 0.42 * (1 - smoothstep(SHIP_ORBIT_IN, T_CONTACT_1, T)) : theta(T);
    ship = { kind: 'orbit', a, drift: 0 };
  } else if (T >= A[8]) {
    if (T < T_REENTRY) ship = { kind: 'home', p: easeInOutSine(seg(T, A[8] + 0.6, T_REENTRY - 1)) };
    else if (T < T_SPLASH) ship = { kind: 'home', p: 1 };
    else ship = { kind: 'sea' };
  }

  const inShip: CrewMember = { place: 'ship', moving: -1 };
  const onEarth: CrewMember = { place: 'earth', moving: -1 };
  const inCapsule: CrewMember = { place: 'capsule', moving: -1 };
  const moonwalker = (out0: number, out1: number, back0: number, back1: number): CrewMember => {
    if (T < out0) return inShip;
    if (T < out1) return { place: 'ship', moving: 0.5 * seg(T, out0, out1) };
    if (T < T_TOUCH) return { place: 'lander', moving: -1 };
    if (T < T_LIFT_3) return { place: 'moon', moving: -1 };
    if (T < back0) return { place: 'lander', moving: -1 };
    if (T < back1) return { place: 'lander', moving: 0.5 + 0.5 * seg(T, back0, back1) };
    return inShip;
  };

  let crew: CrewMember[];
  if (T < A[3]) crew = [onEarth, onEarth, onEarth];
  else if (T < T_SEP) crew = [moonwalker(T_TR_1, T_TR_1 + 2.4, T_TR_2, T_TR_2 + 2.2), moonwalker(T_TR_1 + 1, T_TR_1 + 3.4, T_TR_2 + 0.5, T_TR_2 + 2.7), inShip];
  else if (T < T_SPLASH) crew = [inCapsule, inCapsule, inCapsule];
  else crew = [onEarth, onEarth, onEarth];

  const shipInLunarOrbit = T >= SHIP_ORBIT_IN && T < A[8];
  const orbitCrew = shipInLunarOrbit ? crew.filter((c) => c.place === 'ship').length : 0;
  const moonCrew = crew.filter((c) => c.place === 'lander' || c.place === 'moon').length;

  let sample: SampleState = 'none';
  if (T >= E(6, 'sample')) sample = 'collected';
  if (T >= T_TR_2_END) sample = 'transferred';
  if (T >= T_SPLASH) sample = 'returned';

  return {
    launches: (T >= T_LIFT_1 ? 1 : 0) + (T >= T_LIFT_2 ? 1 : 0),
    dockings: (T >= T_LOCK_1 ? 1 : 0) + (T >= T_LOCK_2 ? 1 : 0),
    orbitCrew,
    moonCrew,
    crew,
    sample,
    phase: phaseLabel(T),
    lander,
    ship,
    ascent,
  };
}

function phaseLabel(T: number): string {
  const A = ACT_START;
  if (T < A[1]) return '目标：2030 年前';
  if (T < A[2]) return T < T_LIFT_1 ? '文昌 · 待发' : '长征十号 · 揽月升空';
  if (T < A[3]) return T < T_BURN ? '地月转移 · 揽月' : T < T_ORBIT ? '近月制动' : '环月停泊 · 揽月待命';
  if (T < A[4]) return T < T_LIFT_2 ? '文昌 · 待发' : T < T_TLI ? '长征十号 · 梦舟升空' : '地月转移 · 梦舟';
  if (T < A[5]) return T < T_CONTACT_1 ? '环月轨道 · 第 1 次对接' : T < T_TR_1 ? '第 1 次对接 · 已锁紧' : '换乘 · 2 人进入揽月';
  if (T < A[6]) return T < T_TOUCH ? '分离 · 降落月面' : '月面 · 软着陆';
  if (T < A[7]) return '月面作业';
  if (T < A[8]) return T < T_LIFT_3 ? '月面 · 准备起飞' : T < T_CONTACT_2 ? '起飞上升' : T < T_TR_2_END ? '第 2 次对接' : '3 人会合';
  if (T < A[9]) return T < T_SEP ? '月地转移' : T < T_SPLASH ? '再入返回' : '海上溅落';
  return '任务完成';
}
