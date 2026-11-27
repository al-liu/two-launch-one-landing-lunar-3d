import { ACTS, ACT_START } from '../core/timeline';
import type { SoundParams } from '../stages/types';

export type Cue = 'ignite' | 'sep' | 'lock' | 'beep' | 'touch' | 'chute' | 'splash' | 'act' | 'click';

const E = (act: number, key: string) => ACT_START[act] + ACTS[act].ev[key];

/** One-shot sounds with their global trigger times. The HUD fires the ones the playhead crosses. */
const cue = (t: number, kind: Cue): { t: number; kind: Cue } => ({ t, kind });

export const CUES: { t: number; kind: Cue }[] = [
  cue(E(1, 'ignite'), 'ignite'),
  cue(E(1, 'boostSep'), 'sep'),
  cue(E(1, 'stageSep'), 'sep'),
  cue(E(1, 'fairing'), 'sep'),
  cue(E(2, 'orbit'), 'beep'),
  cue(E(3, 'ignite'), 'ignite'),
  cue(E(3, 'boostSep'), 'sep'),
  cue(E(4, 'lock'), 'lock'),
  cue(E(4, 'hatch'), 'beep'),
  cue(E(5, 'touch'), 'touch'),
  cue(E(7, 'ignite'), 'ignite'),
  cue(E(7, 'lock'), 'lock'),
  cue(E(8, 'sep'), 'sep'),
  cue(E(8, 'chute'), 'chute'),
  cue(E(8, 'splash'), 'splash'),
].sort((a, b) => a.t - b.t);

// Two chords per act, voiced as [root midi, third, fifth, octave, colour tone].
type Chord = number[];
const Dm = [50, 57, 62, 65, 69];
const Bb = [46, 58, 62, 65, 69];
const F = [41, 57, 60, 65, 69];
const C = [48, 55, 64, 67, 71];
const Gm = [43, 58, 62, 67, 70];
const Am = [45, 57, 64, 69, 72];
const PROGRESSION: Chord[][] = [
  [Dm, Bb],
  [F, C],
  [Gm, Dm],
  [F, C],
  [Bb, F],
  [Gm, Dm],
  [F, Bb],
  [C, Am],
  [Bb, F],
  [Dm, F],
];
const BAR = 8; // seconds per chord
const SCALE = [62, 65, 67, 69, 72, 74, 77, 79]; // D minor pentatonic-ish for the bell motif

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const hash = (a: number, b: number) => {
  let x = Math.imul(a + 11, 374761393) ^ Math.imul(b + 7, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

/** Everything is synthesised with WebAudio; nothing loads from the network. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private rumbleGain!: GainNode;
  private rumbleFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private sub!: OscillatorNode;
  private subGain!: GainNode;
  private lfo!: OscillatorNode;
  private chordBus!: GainNode;
  private lastBar = -1;
  private lastStep = -1;
  private lastAct = -1;
  muted = false;

  get ready(): boolean {
    return !!this.ctx;
  }

  /** Must be called from a user gesture. Safe to call more than once. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(comp);
      this.music = ctx.createGain();
      this.music.gain.value = 0.0;
      this.music.connect(this.master);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.7;
      this.sfx.connect(this.master);

      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let s = 22;
      for (let i = 0; i < len; i++) {
        s = (s * 16807) % 2147483647;
        d[i] = (s / 2147483647) * 2 - 1;
      }
      const loop = (filter: BiquadFilterNode, gain: GainNode, f0: number) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        filter.frequency.value = f0;
        src.connect(filter).connect(gain).connect(this.sfx);
        gain.gain.value = 0;
        src.start();
      };
      this.rumbleGain = ctx.createGain();
      this.rumbleFilter = ctx.createBiquadFilter();
      this.rumbleFilter.type = 'lowpass';
      this.rumbleFilter.Q.value = 1.2;
      loop(this.rumbleFilter, this.rumbleGain, 110);
      this.windGain = ctx.createGain();
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass';
      wf.Q.value = 0.6;
      loop(wf, this.windGain, 900);
      this.sub = ctx.createOscillator();
      this.sub.type = 'sine';
      this.sub.frequency.value = 41;
      this.subGain = ctx.createGain();
      this.subGain.gain.value = 0;
      this.sub.connect(this.subGain).connect(this.sfx);
      this.sub.start();
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = 7.3;
      const lg = ctx.createGain();
      lg.gain.value = 5;
      this.lfo.connect(lg).connect(this.sub.frequency);
      this.lfo.start();
      this.chordBus = ctx.createGain();
      this.chordBus.gain.value = 1;
      this.chordBus.connect(this.music);
      this.music.gain.setTargetAtTime(0.55, ctx.currentTime, 3);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.08);
  }

  /** Continuous layers and the score, driven by the timeline. Call every frame. */
  update(p: SoundParams, act: number, tl: number, playing: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = playing ? 1 : 0.25;
    this.rumbleGain.gain.setTargetAtTime(Math.min(1, p.thrust) * 0.85 * k, t, 0.12);
    this.rumbleFilter.frequency.setTargetAtTime(95 + 190 * Math.min(1, p.thrust), t, 0.3);
    this.subGain.gain.setTargetAtTime(Math.min(1, p.thrust) * 0.5 * k, t, 0.2);
    this.windGain.gain.setTargetAtTime(Math.min(1, p.wind) * 0.35 * k, t, 0.4);
    if (!playing) return;
    // score: one chord per bar, a sparse bell motif every two seconds
    const bar = Math.floor(tl / BAR);
    if (bar !== this.lastBar || act !== this.lastAct) {
      this.lastBar = bar;
      this.lastAct = act;
      const set = PROGRESSION[act] ?? PROGRESSION[0];
      this.chord(set[Math.floor(tl / BAR) % set.length], tl % BAR);
    }
    const step = Math.floor(tl / 2);
    if (step !== this.lastStep && hash(act, step) > 0.45) this.bell(SCALE[Math.floor(hash(act, step + 99) * SCALE.length)], 0.05);
    this.lastStep = step;
  }

  private chord(notes: Chord, age: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dur = BAR;
    const start = t - age;
    notes.forEach((n, i) => {
      for (const det of [-5, 6]) {
        const o = ctx.createOscillator();
        o.type = i < 2 ? 'triangle' : 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.setValueAtTime(260 + i * 90, start);
        f.frequency.linearRampToValueAtTime(900 + i * 160, start + dur * 0.55);
        f.frequency.linearRampToValueAtTime(380, start + dur + 1.5);
        f.Q.value = 0.9;
        const g = ctx.createGain();
        const peak = (i < 2 ? 0.085 : 0.05) / (1 + det * 0.01);
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(peak, start + 2.6);
        g.gain.setValueAtTime(peak, start + dur - 1.2);
        g.gain.linearRampToValueAtTime(0, start + dur + 2.2);
        o.connect(f).connect(g).connect(this.chordBus);
        o.start(start);
        o.stop(start + dur + 2.4);
        o.onended = () => {
          o.disconnect();
          f.disconnect();
          g.disconnect();
        };
      }
    });
  }

  private bell(note: number, level: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = midi(note);
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = midi(note) * 2.01;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 2.4);
    const g2 = ctx.createGain();
    g2.gain.value = 0.25;
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    o.start(t);
    o2.start(t);
    o.stop(t + 2.5);
    o2.stop(t + 2.5);
    o.onended = () => {
      o.disconnect();
      o2.disconnect();
      g.disconnect();
      g2.disconnect();
    };
  }

  private tone(freq: number, dur: number, level: number, type: OscillatorType = 'sine', slideTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private burst(dur: number, level: number, type: BiquadFilterType, f0: number, f1?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t);
    src.stop(t + dur + 0.05);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  cue(kind: Cue): void {
    if (!this.ctx) return;
    switch (kind) {
      case 'ignite':
        this.burst(2.6, 0.5, 'lowpass', 220, 90);
        this.tone(52, 2.2, 0.5);
        break;
      case 'sep':
        this.burst(0.7, 0.28, 'highpass', 1800);
        this.tone(90, 0.35, 0.3, 'triangle', 50);
        break;
      case 'lock':
        this.tone(72, 0.5, 0.55, 'sine', 44);
        this.burst(0.16, 0.3, 'bandpass', 1400);
        this.tone(880, 0.12, 0.14);
        setTimeout(() => this.ctx && this.tone(1320, 0.2, 0.14), 150);
        break;
      case 'beep':
        this.tone(1320, 0.14, 0.1);
        break;
      case 'touch':
        this.tone(60, 0.9, 0.5, 'sine', 36);
        this.burst(0.5, 0.2, 'lowpass', 500);
        break;
      case 'chute':
        this.burst(1.5, 0.4, 'bandpass', 320, 1500);
        this.tone(110, 0.3, 0.25, 'triangle', 70);
        break;
      case 'splash':
        this.burst(1.8, 0.6, 'lowpass', 2600, 300);
        this.tone(48, 1.2, 0.5, 'sine', 32);
        break;
      case 'act':
        this.tone(990, 0.25, 0.06);
        setTimeout(() => this.ctx && this.tone(1480, 0.4, 0.06), 180);
        break;
      case 'click':
        this.tone(2100, 0.05, 0.07);
        break;
    }
  }

  /** Hard reset of the score after a seek, so chords restart cleanly. */
  resync(): void {
    this.lastBar = -1;
    this.lastStep = -1;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
