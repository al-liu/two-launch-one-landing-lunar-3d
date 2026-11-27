import * as THREE from 'three';
import type { App, FrameInfo } from '../app/app';
import { CUES, type AudioEngine } from '../audio/engine';
import { missionState, type CrewPlace, type MissionState, type SampleState } from '../core/missionState';
import { ACTS, TOTAL, cueAt, fmtTime } from '../core/timeline';
import { FACTS, PART_NAMES } from '../data/facts';
import type { Anchor } from '../stages/types';
import { Minimap } from './minimap';

const PLACE_TEXT: Record<CrewPlace, string> = { earth: '地球', ship: '梦舟', lander: '揽月', moon: '月面', capsule: '返回舱' };
const SAMPLE_TEXT: Record<SampleState, string> = {
  none: '月球样品：—',
  collected: '月球样品：已采集 · 随揽月',
  transferred: '月球样品：已转移至梦舟',
  returned: '月球样品：<em>已带回地球</em>',
};
/** Key moments drawn on the scrub bar: [event key, label]. */
const MARKS: Record<number, [string, string][]> = {
  0: [['pull', '拉远'], ['route', '全流程路线']],
  1: [['ignite', '点火'], ['liftoff', '起飞'], ['boostSep', '助推器分离'], ['stageSep', '级间分离'], ['fairing', '整流罩分离']],
  2: [['wideEnd', '近月'], ['burn', '近月制动'], ['orbit', '进入环月轨道']],
  3: [['ignite', '点火'], ['liftoff', '起飞'], ['tli', '奔月'], ['boostSep', '助推器分离']],
  4: [['contact', '接触'], ['lock', '锁紧'], ['hatch', '开舱'], ['transfer', '换乘']],
  5: [['undock', '分离'], ['burn', '点火'], ['touch', '触月']],
  6: [['hatch', '开舱'], ['egress', '出舱'], ['rover', '月球车'], ['sample', '采样']],
  7: [['ignite', '点火'], ['liftoff', '起飞'], ['cut', '上升'], ['contact', '接触'], ['lock', '锁紧'], ['transfer', '样品转移']],
  8: [['sep', '舱段分离'], ['reentry', '再入'], ['chute', '开伞'], ['splash', '溅落']],
  9: [['route', '全流程'], ['nodeEnd', '工程进展'], ['close', '目标']],
};
/** Playback rates, cycled by the speed button. Negative values play the timeline backwards. */
const SPEEDS = [1, 0.5, 0.25, -0.5, -1];
const GOLD_PARTS = new Set(['lander', 'descentStage', 'ascentStage', 'legs']);
const RED_PARTS = new Set(['ship', 'capsule', 'serviceModule', 'escapeTower']);
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Distance from a point to a rectangle, 0 when the point is inside it. */
function reach(x: number, y: number, q: Box): number {
  return Math.hypot(Math.max(q.left - x, 0, x - q.right), Math.max(q.top - y, 0, y - q.bottom));
}

interface Tag {
  root: HTMLElement;
  label: HTMLElement;
  button: HTMLElement | null;
  text: string;
  /** Offset last applied to keep the label inside the window. */
  sx: number;
  sy: number;
  /** Where the label was last put: beside its hotspot on the right (0) or the left (1), above it (2) or below it (3). */
  side: number;
  /** True while the label shows the part's name without the note that follows it. */
  short: boolean;
}

const CREW_SVG = '<svg viewBox="0 0 22 26" aria-hidden="true"><circle cx="11" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 15.5a6.5 5.6 0 0 1 13 0v5.6h-13z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const ROADMAP: { rows: number[][] } = { rows: [[0, 1, 2, 3, 4], [5, 6, 7], [8, 9]] };

export class Hud {
  private app: App;
  private audio: AudioEngine;
  private minimap: Minimap;
  private el: Record<string, HTMLElement> = {};
  private nodes: HTMLButtonElement[] = [];
  private fills: HTMLElement[] = [];
  private crewEls: HTMLElement[] = [];
  private tags = new Map<string, Tag>();
  private tagStage = '';
  private tagT = 0;
  private lastAct = -1;
  private lastCue = '';
  private lastT = 0;
  private captions = true;
  private speedIdx = 0;
  private frameNo = 0;
  private counterVals: Record<string, number> = {};
  private sampleVal: SampleState | '' = '';
  private drag: { x: number; y: number } | null = null;
  private scrubbing: { wasPlaying: boolean } | null = null;
  private hintTimer = 0;
  private mapWidth = 0;
  private pip: FrameInfo['pip'] = null;
  private v = new THREE.Vector3();
  private proj = { x: 0, y: 0, visible: false };

  constructor(app: App, audio: AudioEngine) {
    this.app = app;
    this.audio = audio;
    for (const id of ['btnSubtitles', 'btnSound', 'btnFullscreen', 'whyText', 'cLaunch', 'cDock', 'cOrbit', 'cMoon', 'crewRow', 'sampleRow', 'sampleText', 'actIndex', 'actName', 'subtitle', 'hint', 'btnDirector', 'statusPanel', 'whyPanel', 'minimap', 'mmCanvas', 'mmPhase', 'infoCard', 'infoClose', 'infoKicker', 'infoTitle', 'infoList', 'controls', 'actTimeline', 'scrub', 'scrubFill', 'scrubKnob', 'scrubMarks', 'timeNow', 'timeTotal', 'btnPrev', 'btnPlay', 'btnNext', 'btnReplay', 'btnSpeed', 'startOverlay', 'btnStart', 'fade', 'pipFrame', 'roadmap', 'milestones', 'closing', 'labels', 'gl']) {
      const e = document.getElementById(id);
      if (e) this.el[id] = e;
    }
    this.minimap = new Minimap(this.el.mmCanvas as HTMLCanvasElement);
    this.el.timeTotal.textContent = fmtTime(TOTAL);

    // act timeline
    ACTS.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'act-node';
      b.setAttribute('role', 'tab');
      b.title = `第 ${i} 幕 · ${a.name}`;
      b.innerHTML = `<span class="bar"><i></i></span><span class="lbl"><span class="num">${i}</span><span class="name">${a.short}</span></span>`;
      b.addEventListener('click', () => {
        this.audio.cue('click');
        this.goAct(i);
      });
      this.el.actTimeline.appendChild(b);
      this.nodes.push(b);
      this.fills.push(b.querySelector('i')!);
    });
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'crew-member';
      d.innerHTML = `${CREW_SVG}<b>地球</b>`;
      this.el.crewRow.appendChild(d);
      this.crewEls.push(d);
    }

    // roadmap (finale)
    const rm = this.el.roadmap;
    rm.innerHTML = '<div class="rm-title">一图看懂 · 两次发射、一次登月</div>';
    for (const row of ROADMAP.rows) {
      const r = document.createElement('div');
      r.className = 'rm-row';
      row.forEach((i, k) => {
        if (k > 0) r.insertAdjacentHTML('beforeend', '<span class="rm-arrow">›</span>');
        const b = document.createElement('button');
        b.className = `rm-node${i === 1 || i === 3 ? ' launch' : ''}`;
        b.innerHTML = `<i>${i}</i>${ACTS[i].name.replace(' · ', '·')}`;
        b.title = `点击回看：${ACTS[i].name}`;
        b.addEventListener('click', () => {
          this.audio.cue('click');
          this.goAct(i);
        });
        r.appendChild(b);
      });
      rm.appendChild(r);
    }
    rm.insertAdjacentHTML('beforeend', '<div class="rm-sum">发射 <b>2 / 2</b> · 对接 <b>2 / 2</b> · <b>3</b> 人安全返回 · 月球样品已带回</div>');

    // development milestones, quoted from the fact sheet, and the closing title
    const MS: [string, string][] = [
      ['2025 年 6 月 17 日', '梦舟飞船零高度逃逸飞行试验成功。'],
      ['2025 年 8 月 6 日', '揽月着陆器着陆起飞综合验证试验成功（河北怀来）。'],
      ['2026 年 2 月 11 日', '长征十号低空演示验证与梦舟飞船最大动压逃逸飞行试验成功，返回舱海上溅落并回收。'],
      ['2026 年 7 月 10 日', '长征十号乙首飞成功，实现一子级可控回收。'],
    ];
    const ms = this.el.milestones;
    ms.innerHTML = '<div class="rm-title">研制进展 · 截至 2026 年 11 月</div>' + MS.map(([d, t]) => `<div class="ms-row"><b>${d}</b><span>${t}</span></div>`).join('');
    const next = document.createElement('div');
    next.className = 'ms-row next';
    next.innerHTML = '<b>下一步</b><span>梦舟、揽月无人飞行试验 → 长征十号、梦舟、揽月首飞 → 载人登月。</span>';
    ms.appendChild(next);
    this.el.closing.innerHTML = '<b>2030 年前</b><em>中国人登陆月球</em><span>量力而行 · 轻装登月 · 安全兜底</span>';

    this.wire();
    const q = new URLSearchParams(location.search);
    if (q.has('autoplay') || q.has('pause')) this.el.startOverlay.classList.add('hide');
    else this.el.startOverlay.classList.remove('hide');
    app.onPlayState = (p) => this.setPlaying(p);
    app.rig.onReturned = () => this.el.btnDirector.setAttribute('hidden', '');
  }

  private $(id: string): HTMLElement {
    return this.el[id];
  }

  private wire(): void {
    const { app, audio } = this;
    this.$('btnStart').addEventListener('click', () => {
      audio.start();
      audio.setMuted(audio.muted);
      this.$('startOverlay').classList.add('hide');
      this.$('btnSound').setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
      app.seek(0);
      app.play();
      this.showHint();
    });
    this.$('btnPlay').addEventListener('click', () => this.toggle());
    this.$('btnPrev').addEventListener('click', () => this.goAct(this.lastAct - 1));
    this.$('btnNext').addEventListener('click', () => this.goAct(this.lastAct + 1));
    this.$('btnReplay').addEventListener('click', () => {
      audio.cue('click');
      audio.resync();
      app.seek(0);
      app.play();
    });
    this.$('btnSpeed').addEventListener('click', () => {
      this.speedIdx = (this.speedIdx + 1) % SPEEDS.length;
      app.speed = SPEEDS[this.speedIdx];
      this.$('btnSpeed').textContent = `${app.speed < 0 ? `−${Math.abs(app.speed)}` : app.speed}×`;
      this.$('btnSpeed').title = app.speed < 0 ? '倒放（点击切换速度）' : `慢放 ${app.speed}×（点击切换速度）`;
    });
    this.$('btnSound').addEventListener('click', () => {
      // the first click both unlocks audio and decides the state
      if (!audio.ready) {
        audio.start();
        audio.setMuted(false);
      } else audio.setMuted(!audio.muted);
      this.$('btnSound').setAttribute('aria-pressed', audio.muted ? 'true' : 'false');
      this.$('btnSound').title = audio.muted ? '开启声音' : '静音';
    });
    this.$('btnSubtitles').addEventListener('click', () => {
      this.captions = !this.captions;
      this.$('btnSubtitles').setAttribute('aria-pressed', String(this.captions));
      this.$('subtitle').classList.toggle('off', !this.captions);
    });
    this.$('btnFullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    });
    this.$('btnDirector').addEventListener('click', () => app.rig.reset());
    this.$('infoClose').addEventListener('click', () => this.closeInfo());
    window.addEventListener('keydown', this.onKey);

    // scrubbing the act
    const scrub = this.$('scrub');
    const toTime = (e: PointerEvent) => {
      const r = scrub.getBoundingClientRect();
      const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const a = ACTS[Math.max(0, this.lastAct)];
      app.seek(ACTS.reduce((s, x, i) => (i < this.lastAct ? s + x.duration : s), 0) + u * a.duration);
    };
    scrub.addEventListener('pointerdown', (e) => {
      scrub.setPointerCapture(e.pointerId);
      this.scrubbing = { wasPlaying: app.playing };
      app.pause();
      toTime(e);
    });
    scrub.addEventListener('pointermove', (e) => {
      if (this.scrubbing) toTime(e);
    });
    const end = () => {
      if (this.scrubbing?.wasPlaying) app.play();
      this.scrubbing = null;
      // after a pointer drag the arrow keys go back to switching acts; Tab still brings the bar under keyboard control
      if (document.activeElement === scrub) scrub.blur();
    };
    scrub.addEventListener('pointerup', end);
    scrub.addEventListener('pointercancel', end);

    // clicking a vehicle part
    const gl = this.$('gl');
    gl.addEventListener('pointerdown', (e) => (this.drag = { x: e.clientX, y: e.clientY }));
    gl.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
      const hit = app.pick(e.clientX, e.clientY);
      if (hit) this.openInfo(hit.part, e.clientX, e.clientY);
      else this.closeInfo();
    });
  }

  private onKey = (e: KeyboardEvent): void => {
    const { app } = this;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (!this.$('startOverlay').classList.contains('hide') && e.code !== 'Space' && e.code !== 'Enter') return;
    // with the scrub bar focused, the arrow keys step inside the act instead of leaving it
    if (document.activeElement === this.$('scrub') && e.code.startsWith('Arrow')) {
      const i = Math.max(0, this.lastAct);
      const base = app.actStart(i);
      const step = (e.code === 'ArrowRight' || e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 2);
      app.pause();
      app.seek(Math.min(base + ACTS[i].duration - 0.02, Math.max(base, app.T + step)));
      e.preventDefault();
      return;
    }
    switch (e.code) {
      case 'Space':
      case 'Enter':
        if (this.$('startOverlay').classList.contains('hide')) this.toggle();
        else this.$('btnStart').click();
        break;
      case 'ArrowLeft':
        this.goAct(this.lastAct - 1);
        break;
      case 'ArrowRight':
        this.goAct(this.lastAct + 1);
        break;
      case 'KeyR':
        app.seek(0);
        app.play();
        break;
      case 'KeyM':
        this.$('btnSound').click();
        break;
      case 'KeyF':
        this.$('btnFullscreen').click();
        break;
      case 'KeyC':
        this.$('btnSubtitles').click();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  private toggle(): void {
    if (this.app.playing) this.app.pause();
    else {
      if (!this.audio.ready) {
        this.audio.start();
        this.audio.setMuted(this.audio.muted);
        this.$('btnSound').setAttribute('aria-pressed', String(this.audio.muted));
      }
      this.audio.resync();
      this.app.play();
    }
  }

  private setPlaying(p: boolean): void {
    this.$('btnPlay').classList.toggle('playing', p);
    this.$('btnPlay').setAttribute('aria-label', p ? '暂停' : '播放');
    this.$('btnPlay').title = p ? '暂停（空格）' : '播放（空格）';
  }

  goAct(i: number, tl = 0): void {
    if (i < 0 || i >= ACTS.length) return;
    this.audio.resync();
    this.app.seekAct(i, tl);
    this.lastT = this.app.T;
    this.closeInfo();
  }

  private showHint(): void {
    const h = this.$('hint');
    h.classList.add('on');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => h.classList.remove('on'), 6500);
  }

  openInfo(part: string, x: number, y: number): void {
    const f = FACTS[part];
    if (!f) return;
    this.audio.cue('click');
    this.$('infoKicker').textContent = f.kicker;
    this.$('infoTitle').textContent = f.title;
    this.$('infoList').innerHTML = f.lines.map((l) => `<li>${l}</li>`).join('');
    const card = this.$('infoCard');
    card.hidden = false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    card.style.left = `${Math.min(Math.max(12, x + 22 > w - cw - 12 ? x - cw - 22 : x + 22), w - cw - 12)}px`;
    card.style.top = `${Math.min(Math.max(76, y - 30), h - ch - 150)}px`;
  }

  closeInfo(): void {
    this.$('infoCard').hidden = true;
  }

  /** One element per stage and anchor: the same id means different things on different stages. */
  private tagFor(a: Anchor, key: string): Tag {
    let t = this.tags.get(key);
    if (!t) {
      const root = document.createElement('div');
      let button: HTMLElement | null = null;
      const cls = a.part ? (GOLD_PARTS.has(a.part) ? 'gold' : RED_PARTS.has(a.part) ? 'red' : '') : a.id === 'lander' || a.id === 'ascent' ? 'gold' : a.id === 'ship' ? 'red' : '';
      if (a.part) {
        root.className = `tag ${cls}`;
        const b = document.createElement('button');
        b.className = 'hotspot';
        b.textContent = '+';
        b.title = PART_NAMES[a.part] ?? a.label;
        b.setAttribute('aria-label', `查看${PART_NAMES[a.part] ?? a.label}信息`);
        b.addEventListener('click', () => {
          const r = b.getBoundingClientRect();
          this.openInfo(a.part!, r.left + 17, r.top + 17);
        });
        root.appendChild(b);
        button = b;
      } else {
        root.className = `tag plain ${cls}${a.id === 'dist' ? ' wide' : ''}`;
      }
      const label = document.createElement('span');
      label.className = 'label';
      root.appendChild(label);
      this.$('labels').appendChild(root);
      t = { root, label, button, text: '', sx: 0, sy: 0, side: 0, short: false };
      this.tags.set(key, t);
    }
    return t;
  }

  private updateTags(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const test = this.frameNo % 4 === 0;
    const stage = this.app.stageId();
    // after a jump in time or a change of stage a label that no longer applies goes at once
    const jump = stage !== this.tagStage || Math.abs(this.app.T - this.tagT) > 1.5;
    this.tagStage = stage;
    this.tagT = this.app.T;
    const m = 8;
    const shown = new Set<string>();
    const placed: { label: Box; spot: Circle | null }[] = [];
    // panels, the finale cards, the picture-in-picture and the subtitle keep their corners of the screen clear of labels
    const blockers: Box[] = [];
    for (const id of ['statusPanel', 'whyPanel', 'minimap', 'controls']) {
      const r = this.$(id).getBoundingClientRect();
      if (r.width > 0 && r.height > 0) blockers.push(r);
    }
    // the finale cards are only faded out, never taken out of the layout: the ones on screen count
    for (const id of ['roadmap', 'milestones', 'closing']) if (this.$(id).classList.contains('on')) blockers.push(this.$(id).getBoundingClientRect());
    if (this.el.subtitle.classList.contains('on')) blockers.push(this.el.subtitle.getBoundingClientRect());
    if (!this.el.infoCard.hidden) blockers.push(this.el.infoCard.getBoundingClientRect());
    // the title of the close-up sits above its frame
    if (this.pip) blockers.push({ left: this.pip.left - 12, top: this.pip.top - 30, right: this.pip.left + this.pip.width + 6, bottom: this.pip.top + this.pip.height + 6 } as DOMRect);
    const hits = (r: Box, q: Box) => r.left < q.right + 6 && r.right + 6 > q.left && r.top < q.bottom + 4 && r.bottom + 4 > q.top;
    // a hotspot is a circle: it is clear of a rectangle once its edge keeps `gap` pixels from it
    const apart = (c: Circle, q: Box, gap: number) => reach(c.x, c.y, q) >= c.r + gap;
    // "on" is written once per frame, with the final verdict. Switching it on and off again inside one frame
    // leaves the label fully visible in the browser, on top of the one that won its place.
    const hide = (t: Tag, atOnce: boolean) => {
      if (!t.root.classList.contains('on')) return;
      t.root.classList.remove('on');
      // "cut" drops the opacity transition for this one change, so a label that lost its place does not fade across a neighbour
      if (atOnce) t.root.classList.add('cut');
      // next time it appears it starts again with its full label
      t.short = false;
    };
    for (const a of this.app.anchors()) {
      const key = `${stage}:${a.id}`;
      shown.add(key);
      const t = this.tagFor(a, key);
      let keep = false;
      let rejected = false;
      if (a.show) {
        this.v.copy(a.local);
        a.target.localToWorld(this.v);
        const p = this.proj;
        // a hotspot is a 34 px circle: its anchor has to keep that circle inside the window
        const edge = a.part ? 22 : 10;
        if (this.app.project(this.v, p) && p.x >= edge && p.x <= w - edge && p.y >= edge && p.y <= h - edge) {
          t.root.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
          // a part that is hidden behind its own craft gets no label
          if (a.part && test) t.root.classList.toggle('off', this.app.occluded(this.v, a.target));
          // A part whose full label found no room goes by its name alone ("推进舱 · 近月制动" → "推进舱").
          const name = (short: boolean) => {
            t.short = short;
            const text = short ? a.label.split(' · ')[0] : a.label;
            if (t.text !== text) {
              t.text = text;
              t.label.textContent = text;
            }
          };
          // The tag element itself is a point: what has to stay clear is the label (a rectangle) and the
          // hotspot (a circle). A label that would cross the edge of the window is slid inwards; one too
          // wide or tall for it is not shown. A part's label goes where it was last shown if that still
          // works; otherwise it tries the other side of its hotspot, above it and below it.
          const hb = t.button?.getBoundingClientRect();
          const disc: Circle | null = hb ? { x: (hb.left + hb.right) / 2, y: (hb.top + hb.bottom) / 2, r: hb.width / 2 } : null;
          const put = (v: number) => {
            t.root.classList.toggle('flip', v === 1);
            t.root.classList.toggle('over', v === 2);
            t.root.classList.toggle('under', v === 3);
            const l = t.label.getBoundingClientRect();
            const left = l.left - t.sx;
            const right = l.right - t.sx;
            const top = l.top - t.sy;
            const bottom = l.bottom - t.sy;
            const fits = right - left <= w - 2 * m && bottom - top <= h - 2 * m;
            const sx = !fits ? 0 : right > w - m ? w - m - right : left < m ? m - left : 0;
            const sy = !fits ? 0 : top < m ? m - top : bottom > h - m ? h - m - bottom : 0;
            const c: Box = { left: left + sx, right: right + sx, top: top + sy, bottom: bottom + sy };
            return { c, fits, sx, sy };
          };
          // the label and its hotspot must keep clear of the panels, of each other and of every label placed before them
          const free = (o: { c: Box; fits: boolean }) =>
            o.fits &&
            !blockers.some((q) => hits(o.c, q) || (!!disc && !apart(disc, q, 4))) &&
            !(disc && !apart(disc, o.c, 6)) &&
            !placed.some(
              (s) =>
                hits(o.c, s.label) ||
                (!!disc && ((!!s.spot && Math.hypot(disc.x - s.spot.x, disc.y - s.spot.y) < disc.r + s.spot.r + 4) || !apart(disc, s.label, 6))) ||
                (!!s.spot && !apart(s.spot, o.c, 6)),
            );
          const place = () => {
            const order = t.button ? [t.side, ...[0, 1, 2, 3].filter((v) => v !== t.side)] : [0];
            const options = order.map(put);
            const use = options.findIndex(free);
            if (use >= 0) t.side = order[use];
            return { o: options[use < 0 ? 0 : use], use };
          };
          name(!!a.part && t.short);
          let spot = place();
          if (spot.use < 0 && a.part && !t.short && a.label.includes(' · ')) {
            name(true);
            spot = place();
          }
          const o = spot.o;
          if (o.sx !== t.sx) {
            t.sx = o.sx;
            t.label.style.setProperty('--dx', `${o.sx.toFixed(1)}px`);
          }
          if (o.sy !== t.sy) {
            t.sy = o.sy;
            t.label.style.setProperty('--dy', `${o.sy.toFixed(1)}px`);
          }
          t.root.classList.toggle('flip', t.side === 1);
          t.root.classList.toggle('over', t.side === 2);
          t.root.classList.toggle('under', t.side === 3);
          // on a small screen several labels can land on the same spot: the first ones shown win
          if (spot.use >= 0) {
            keep = !t.root.classList.contains('off');
            if (keep) placed.push({ label: o.c, spot: disc });
          }
          rejected = !keep;
        }
      }
      if (keep) {
        if (!t.root.classList.contains('on')) {
          t.root.classList.remove('cut');
          t.root.classList.add('on');
        }
      } else hide(t, jump || rejected);
    }
    // a stage that has been left must not leave its labels behind
    for (const [key, t] of this.tags) if (!shown.has(key)) hide(t, true);
  }

  private updateStatus(st: MissionState): void {
    const counters: [string, number, boolean][] = [
      ['cLaunch', st.launches, st.launches === 2],
      ['cDock', st.dockings, st.dockings === 2],
      ['cOrbit', st.orbitCrew, false],
      ['cMoon', st.moonCrew, false],
    ];
    for (const [id, value, done] of counters) {
      const box = this.$(id);
      const prev = this.counterVals[id];
      if (prev === value) continue;
      this.counterVals[id] = value;
      box.querySelector('.c-num')!.firstChild!.textContent = String(value);
      box.classList.toggle('done', done);
      if (prev !== undefined && value !== prev) {
        box.classList.remove('bump');
        void box.offsetWidth;
        box.classList.add('bump');
      }
    }
    st.crew.forEach((m, i) => {
      const e = this.crewEls[i];
      const cls = m.moving >= 0 ? 'moving' : m.place;
      if (e.dataset.state === cls) return;
      e.dataset.state = cls;
      e.className = `crew-member ${cls}`;
      e.querySelector('b')!.textContent = m.moving >= 0 ? '换乘中' : PLACE_TEXT[m.place];
    });
    if (this.sampleVal !== st.sample) {
      this.sampleVal = st.sample;
      this.$('sampleText').innerHTML = SAMPLE_TEXT[st.sample];
      const row = this.$('sampleRow');
      row.classList.toggle('has', st.sample === 'collected' || st.sample === 'transferred');
      row.classList.toggle('back', st.sample === 'returned');
    }
  }

  private enterAct(i: number): void {
    const act = ACTS[i];
    this.$('actIndex').textContent = String(i).padStart(2, '0');
    this.$('actName').textContent = act.name;
    this.$('scrubMarks').innerHTML = (MARKS[i] ?? [])
      .filter(([k]) => act.ev[k] !== undefined && act.ev[k] > 0.4 && act.ev[k] < act.duration - 0.6)
      .map(([k, label]) => `<span class="mark" style="left:${((act.ev[k] / act.duration) * 100).toFixed(2)}%" title="${label}"></span>`)
      .join('');
    this.$('scrubMarks').setAttribute('aria-label', `关键节点：${(MARKS[i] ?? []).map(([, l]) => l).join('、')}`);
    const why = this.$('whyText');
    why.classList.add('fade');
    window.setTimeout(() => {
      why.textContent = `为什么这样设计：${act.why}`;
      why.classList.remove('fade');
    }, 220);
    for (const id of ['roadmap', 'milestones', 'closing']) this.$(id).classList.remove('on');
    document.body.classList.remove('finale');
    this.closeInfo();
  }

  frame(info: FrameInfo): void {
    this.frameNo++;
    const { audio } = this;
    const act = ACTS[info.act];
    const st = missionState(info.T);

    // one-shot sounds when the playhead crosses an event while playing forwards
    if (info.playing && info.T > this.lastT && info.T - this.lastT < 0.5) {
      for (const c of CUES) if (c.t > this.lastT && c.t <= info.T) audio.cue(c.kind);
    }
    this.lastT = info.T;

    if (info.act !== this.lastAct) {
      const first = this.lastAct === -1;
      this.lastAct = info.act;
      this.nodes.forEach((n, i) => {
        n.classList.toggle('cur', i === info.act);
        n.setAttribute('aria-selected', String(i === info.act));
        n.classList.toggle('past', i < info.act);
      });
      this.enterAct(info.act);
      if (!first && info.playing) audio.cue('act');
    }
    this.fills[info.act].style.transform = `scaleX(${info.u.toFixed(4)})`;
    this.fills.forEach((f, i) => {
      if (i !== info.act) f.style.transform = `scaleX(${i < info.act ? 1 : 0})`;
    });
    this.$('scrubFill').style.transform = `scaleX(${info.u.toFixed(4)})`;
    this.$('scrubKnob').style.left = `${(info.u * 100).toFixed(2)}%`;
    this.$('scrub').setAttribute('aria-valuenow', String(Math.round(info.u * 100)));
    this.$('scrub').setAttribute('aria-valuetext', `${act.name} ${fmtTime(info.tl)} / ${fmtTime(act.duration)}`);
    this.$('timeNow').textContent = fmtTime(info.T);
    this.$('fade').style.opacity = info.fade.toFixed(3);

    const cue = this.captions ? cueAt(info.act, info.tl)?.text ?? '' : '';
    if (cue !== this.lastCue) {
      this.lastCue = cue;
      const s = this.$('subtitle');
      s.classList.toggle('on', !!cue);
      if (cue) s.textContent = cue;
    }

    this.updateStatus(st);
    this.pip = info.pip;
    if (this.frameNo % 2 === 0) {
      // the map is drawn on a fixed-size canvas: its lettering grows when the map is shown small (phones)
      const cw = this.el.mmCanvas.clientWidth;
      if (cw !== this.mapWidth) {
        this.mapWidth = cw;
        this.minimap.setFont(Math.round(22 * Math.min(1.6, Math.max(1, 230 / Math.max(cw, 1)))));
      }
      this.minimap.draw(st, act, info.T);
      this.$('mmPhase').textContent = st.phase;
    }
    // finale: flow chart → milestones → closing title
    if (info.act === 9) {
      this.$('roadmap').classList.toggle('on', info.tl < 7.6);
      const ms = info.tl >= 7.6 && info.tl < 22.4;
      this.$('milestones').classList.toggle('on', ms);
      // on a phone both cards need the corner the minimap sits in
      document.body.classList.toggle('finale', info.tl < 22.4);
      this.$('milestones').querySelector('.next')?.classList.toggle('show', info.tl >= 16.4);
      this.$('closing').classList.toggle('on', info.tl >= act.ev.close);
    }

    this.updateTags();

    const pip = this.$('pipFrame');
    if (info.pip) {
      // the stage decides when a close-up is worth a picture-in-picture
      pip.hidden = false;
      {
        pip.style.left = `${info.pip.left - 1}px`;
        pip.style.top = `${info.pip.top - 1}px`;
        pip.style.width = `${info.pip.width}px`;
        pip.style.height = `${info.pip.height}px`;
      }
    } else pip.hidden = true;
    this.$('btnDirector').hidden = !this.app.rig.free;
    audio.update(info.sound, info.act, info.tl, info.playing);
  }
}

