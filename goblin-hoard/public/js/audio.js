/**
 * audio.js - a small chiptune engine: WebAudio oscillators, a step sequencer
 * and a pile of synthesised sound effects. No audio files are shipped.
 *
 * The AudioContext is only created on a real user gesture (`unlock()`), which
 * is what browser autoplay policies require.
 */

const SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "a3", "c#4", "eb2" -> Hz. Returns 0 for a rest. */
function freq(token) {
  if (!token || token === '-' || token === '.') return 0;
  const m = /^([a-g])([#b]?)(-?\d)$/.exec(token.toLowerCase());
  if (!m) return 0;
  let s = SEMI[m[1]];
  if (m[2] === '#') s += 1;
  else if (m[2] === 'b') s -= 1;
  const midi = (parseInt(m[3], 10) + 1) * 12 + s;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const pat = (s) => s.trim().split(/\s+/);

/**
 * Each channel loops at its own length, so a miscounted bar shifts the groove
 * rather than breaking the track.
 */
const TRACKS = {
  title: {
    bpm: 126,
    ch: [
      { v: 'lead', gain: 0.20, dur: 0.9, p: pat(`
        a4 -  c5 -  e5 -  d5 c5 -  a4 -  -  -  -  -  -
        f4 -  a4 -  c5 -  a4 g4 -  f4 -  -  -  -  -  -
        c5 -  e5 -  g5 -  e5 d5 -  c5 -  -  -  -  -  -
        b4 -  d5 -  g5 -  d5 b4 -  g4 -  -  -  -  -  -`) },
      { v: 'harm', gain: 0.10, dur: 0.6, p: pat(`
        a3 - e4 - a3 - c4 - a3 - e4 - a3 - c4 -
        f3 - c4 - f3 - a3 - f3 - c4 - f3 - a3 -
        c4 - g3 - c4 - e4 - c4 - g3 - c4 - e4 -
        g3 - d4 - g3 - b3 - g3 - d4 - g3 - b3 -`) },
      { v: 'bass', gain: 0.26, dur: 0.8, p: pat(`
        a1 - - - a1 - - - e2 - - - a1 - - -
        f1 - - - f1 - - - c2 - - - f1 - - -
        c2 - - - c2 - - - g2 - - - c2 - - -
        g1 - - - g1 - - - d2 - - - g1 - - -`) },
      { v: 'drum', gain: 0.5, p: pat('K - h - S - h - K - h K S - h -') },
    ],
  },

  // Level 1 - bouncy and cheerful, the goblin is having a nice time.
  ruins: {
    bpm: 144,
    ch: [
      { v: 'lead', gain: 0.17, dur: 0.75, p: pat(`
        a4 -  a4 b4 c5 -  b4 -  a4 -  g4 -  e4 -  -  -
        f4 -  f4 g4 a4 -  g4 -  f4 -  e4 -  c4 -  -  -
        g4 -  g4 a4 b4 -  a4 -  g4 -  d5 -  b4 -  -  -
        e5 -  d5 -  c5 -  b4 a4 -  b4 -  -  -  -  -  -`) },
      { v: 'harm', gain: 0.085, dur: 0.5, p: pat(`
        e4 - a3 - e4 - c4 - e4 - a3 - e4 - c4 -
        c4 - f3 - c4 - a3 - c4 - f3 - c4 - a3 -
        d4 - g3 - d4 - b3 - d4 - g3 - d4 - b3 -
        e4 - a3 - e4 - c4 - b3 - e4 - g3 - b3 -`) },
      { v: 'bass', gain: 0.27, dur: 0.5, p: pat(`
        a1 - a2 - a1 - a2 e2 f1 - f2 - f1 - f2 -
        g1 - g2 - g1 - g2 d2 a1 - a2 - e2 - e1 -`) },
      { v: 'drum', gain: 0.5, p: pat('K - h - S - h K - K h - S - h h') },
    ],
  },

  // Level 2 - cold, cavernous, a lot more space between the notes.
  mines: {
    bpm: 118,
    ch: [
      { v: 'lead', gain: 0.16, dur: 1.2, p: pat(`
        d4 -  -  f4 -  -  a4 -  -  g4 -  f4 -  -  -  -
        -  -  d4 -  -  c4 -  -  a3 -  -  -  -  -  -  -
        bb3 - -  d4 -  -  f4 -  -  e4 -  d4 -  -  -  -
        -  -  a3 -  -  -  -  -  -  -  -  -  -  -  -  -`) },
      { v: 'harm', gain: 0.075, dur: 1.6, p: pat(`
        d3 - - - - - - - a3 - - - - - - -
        f3 - - - - - - - c4 - - - - - - -
        bb2 - - - - - - - f3 - - - - - - -
        a2 - - - - - - - e3 - - - - - - -`) },
      { v: 'bass', gain: 0.3, dur: 0.9, p: pat(`
        d1 - - - d1 - - - d1 - a1 - d1 - - -
        bb1 - - - bb1 - - - f1 - - - a1 - - -`) },
      { v: 'drum', gain: 0.42, p: pat('K - - h S - - - K - - - S - h -') },
    ],
  },

  // Level 3 - fast, relentless, everything is on fire.
  keep: {
    bpm: 162,
    ch: [
      { v: 'lead', gain: 0.17, dur: 0.6, p: pat(`
        e4 e4 -  g4 -  b4 -  a4 g4 -  e4 -  d4 -  -  -
        e4 e4 -  g4 -  c5 -  b4 a4 -  g4 -  e4 -  -  -
        f4 f4 -  a4 -  c5 -  b4 a4 -  f4 -  e4 -  -  -
        b4 -  a4 -  g4 -  f4 -  e4 -  -  -  -  -  -  -`) },
      { v: 'harm', gain: 0.09, dur: 0.35, p: pat(`
        e3 b3 e3 b3 e3 b3 e3 b3 e3 b3 e3 b3 g3 b3 g3 b3
        a3 e4 a3 e4 a3 e4 a3 e4 f3 c4 f3 c4 b3 f4 b3 f4`) },
      { v: 'bass', gain: 0.3, dur: 0.3, p: pat(`
        e1 e1 e2 e1 e1 e1 e2 e1 g1 g1 g2 g1 g1 g1 g2 g1
        a1 a1 a2 a1 a1 a1 a2 a1 b1 b1 b2 b1 f1 f1 f2 f1`) },
      { v: 'drum', gain: 0.52, p: pat('K h S h K h S h K h S h K K S h') },
    ],
  },

  // Boss - chromatic, mean, no resolution.
  daemon: {
    bpm: 150,
    ch: [
      { v: 'lead', gain: 0.17, dur: 0.5, p: pat(`
        c4 -  db4 - c4 -  g3 -  c4 -  db4 - eb4 - d4 -
        c4 -  db4 - c4 -  ab3 - g3 -  gb3 - f3 -  e3 -
        ab3 - a3 -  bb3 - b3 -  c4 -  db4 - d4 -  eb4 -
        e4 -  -  -  eb4 - -  -  d4 -  -  -  db4 - -  -`) },
      { v: 'harm', gain: 0.08, dur: 0.25, p: pat(`
        c3 g3 c3 g3 db3 ab3 db3 ab3 c3 g3 c3 g3 b2 gb3 b2 gb3`) },
      { v: 'bass', gain: 0.33, dur: 0.25, p: pat(`
        c1 c1 c1 db1 c1 c1 c1 b0 c1 c1 c1 db1 eb1 eb1 d1 db1`) },
      { v: 'drum', gain: 0.55, p: pat('K K S h K - S h K K S K S h S h') },
    ],
  },

  victory: {
    bpm: 150, once: true,
    ch: [
      { v: 'lead', gain: 0.22, dur: 1.0, p: pat('c4 e4 g4 c5 - g4 c5 - - e5 - - c5 - - - - - - -') },
      { v: 'harm', gain: 0.12, dur: 1.0, p: pat('c3 e3 g3 c4 - g3 c4 - - g4 - - e4 - - - - - - -') },
      { v: 'bass', gain: 0.28, dur: 0.8, p: pat('c2 - - c2 - - g1 - - c2 - - c2 - - - - - - -') },
      { v: 'drum', gain: 0.5, p: pat('K - S - K - S - K K S - K - - - - - - -') },
    ],
  },

  defeat: {
    bpm: 96, once: true,
    ch: [
      { v: 'lead', gain: 0.2, dur: 1.4, p: pat('a3 - g3 - f3 - e3 - - - a2 - - - - -') },
      { v: 'bass', gain: 0.28, dur: 1.4, p: pat('a2 - g2 - f2 - e2 - - - a1 - - - - -') },
    ],
  },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.trackName = null;
    this.track = null;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.noiseBuf = null;
  }

  /** Must be called from a real user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.62;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    // One second of white noise, reused by every percussive sound.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    if (this.pendingTrack) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.music(t);
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) {
      this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.02);
    }
  }

  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  /* ------------------------------------------------------------- synthesis */

  _tone(opts) {
    if (!this.ctx) return;
    const t = opts.t ?? this.ctx.currentTime;
    const dur = opts.dur ?? 0.15;
    const bus = opts.bus || this.sfxBus;
    const g = this.ctx.createGain();
    const peak = opts.vol ?? 0.2;
    const atk = opts.atk ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let out = g;
    if (opts.cutoff) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.cutoff, t);
      if (opts.cutoffEnd) f.frequency.exponentialRampToValueAtTime(opts.cutoffEnd, t + dur);
      f.Q.value = opts.q ?? 1;
      g.connect(f);
      f.connect(bus);
      out = f;
    } else {
      g.connect(bus);
    }

    const voices = opts.detune ? [-opts.detune, opts.detune] : [0];
    for (const cents of voices) {
      const o = this.ctx.createOscillator();
      o.type = opts.type || 'square';
      o.detune.value = cents;
      o.frequency.setValueAtTime(Math.max(20, opts.f0), t);
      if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + dur);
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    return out;
  }

  _noise(opts) {
    if (!this.ctx || !this.noiseBuf) return;
    const t = opts.t ?? this.ctx.currentTime;
    const dur = opts.dur ?? 0.1;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = opts.rate ?? 1;

    const f = this.ctx.createBiquadFilter();
    f.type = opts.filter || 'bandpass';
    f.frequency.setValueAtTime(opts.f0 ?? 1200, t);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.f1), t + dur);
    f.Q.value = opts.q ?? 1;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, opts.vol ?? 0.2), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(f); f.connect(g); g.connect(opts.bus || this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /* ------------------------------------------------------------ sequencer  */

  _voice(kind, note, t, stepDur, ch) {
    const bus = this.musicBus;
    if (kind === 'drum') {
      const g = ch.gain;
      if (note === 'K') {
        this._tone({ type: 'sine', f0: 150, f1: 46, t, dur: 0.16, vol: 0.5 * g, bus });
        this._noise({ t, dur: 0.05, vol: 0.14 * g, filter: 'lowpass', f0: 900, bus });
      } else if (note === 'S') {
        this._noise({ t, dur: 0.13, vol: 0.28 * g, filter: 'highpass', f0: 1400, bus });
        this._tone({ type: 'triangle', f0: 220, f1: 140, t, dur: 0.09, vol: 0.14 * g, bus });
      } else if (note === 'h') {
        this._noise({ t, dur: 0.035, vol: 0.1 * g, filter: 'highpass', f0: 7000, bus });
      }
      return;
    }

    const f = freq(note);
    if (!f) return;
    const dur = stepDur * (ch.dur ?? 0.8);
    if (kind === 'lead') {
      this._tone({ type: 'square', f0: f, t, dur, vol: ch.gain, detune: 8, cutoff: 3600, bus, atk: 0.008 });
    } else if (kind === 'harm') {
      this._tone({ type: 'triangle', f0: f, t, dur, vol: ch.gain, bus, atk: 0.01 });
    } else if (kind === 'bass') {
      this._tone({ type: 'square', f0: f / 2, t, dur, vol: ch.gain, cutoff: 900, bus });
      this._tone({ type: 'triangle', f0: f / 2, t, dur, vol: ch.gain * 0.7, bus });
    }
  }

  _schedule() {
    if (!this.ctx || !this.track) return;
    const stepDur = 60 / this.track.bpm / 4;
    const horizon = this.ctx.currentTime + 0.2;
    let guard = 0;
    while (this.nextTime < horizon && guard++ < 64) {
      for (const ch of this.track.ch) {
        const note = ch.p[this.step % ch.p.length];
        this._voice(ch.v, note, this.nextTime, stepDur, ch);
      }
      this.step++;
      this.nextTime += stepDur;
      if (this.track.once) {
        const longest = Math.max(...this.track.ch.map((c) => c.p.length));
        if (this.step >= longest) { this._stopTimer(); this.track = null; this.trackName = null; break; }
      }
    }
  }

  _stopTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Start a looping track by name, or pass null to stop the music. */
  music(name) {
    if (!this.ctx) { this.pendingTrack = name; return; }
    if (name === this.trackName && this.track) return;
    this._stopTimer();
    this.track = null;
    this.trackName = name;
    if (!name || !TRACKS[name]) return;
    this.track = TRACKS[name];
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.06;
    this._schedule();
    this.timer = setInterval(() => this._schedule(), 40);
  }

  /* ------------------------------------------------------------------ sfx  */

  sfx(name) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'jump':
        this._tone({ type: 'square', f0: 300, f1: 660, t, dur: 0.12, vol: 0.2 });
        break;
      case 'doubleJump':
        this._tone({ type: 'square', f0: 460, f1: 900, t, dur: 0.13, vol: 0.18 });
        this._noise({ t, dur: 0.12, vol: 0.09, filter: 'bandpass', f0: 2200, f1: 500 });
        break;
      case 'land':
        this._noise({ t, dur: 0.07, vol: 0.13, filter: 'lowpass', f0: 700, f1: 220 });
        break;
      case 'whip':
        this._noise({ t, dur: 0.16, vol: 0.2, filter: 'bandpass', f0: 3800, f1: 420, q: 1.4 });
        this._tone({ type: 'sawtooth', f0: 680, f1: 180, t, dur: 0.1, vol: 0.09, cutoff: 2600 });
        break;
      case 'hit':
        this._noise({ t, dur: 0.09, vol: 0.2, filter: 'bandpass', f0: 1800, f1: 600, q: 0.8 });
        this._tone({ type: 'square', f0: 420, f1: 150, t, dur: 0.1, vol: 0.14 });
        break;
      case 'block':
        this._tone({ type: 'square', f0: 1400, f1: 900, t, dur: 0.07, vol: 0.13 });
        this._noise({ t, dur: 0.06, vol: 0.1, filter: 'highpass', f0: 4000 });
        break;
      case 'kill':
        this._noise({ t, dur: 0.22, vol: 0.2, filter: 'lowpass', f0: 2600, f1: 260 });
        this._tone({ type: 'square', f0: 620, f1: 90, t, dur: 0.24, vol: 0.16 });
        break;
      case 'shoot':
        this._tone({ type: 'sawtooth', f0: 900, f1: 260, t, dur: 0.12, vol: 0.12, cutoff: 3000 });
        break;
      case 'hurt':
        this._tone({ type: 'sawtooth', f0: 400, f1: 90, t, dur: 0.34, vol: 0.22, cutoff: 1800 });
        this._noise({ t, dur: 0.2, vol: 0.12, filter: 'lowpass', f0: 1600, f1: 300 });
        break;
      case 'die':
        this._tone({ type: 'square', f0: 520, f1: 60, t, dur: 0.75, vol: 0.22 });
        this._tone({ type: 'square', f0: 262, f1: 40, t: t + 0.06, dur: 0.8, vol: 0.14 });
        break;
      case 'coin':
        this._tone({ type: 'square', f0: 1046, t, dur: 0.05, vol: 0.13 });
        this._tone({ type: 'square', f0: 1568, t: t + 0.05, dur: 0.1, vol: 0.13 });
        break;
      case 'gem':
        [1318, 1760, 2093].forEach((f, i) =>
          this._tone({ type: 'square', f0: f, t: t + i * 0.05, dur: 0.12, vol: 0.12 }));
        break;
      case 'heart':
        [523, 659, 784, 1046].forEach((f, i) =>
          this._tone({ type: 'triangle', f0: f, t: t + i * 0.06, dur: 0.18, vol: 0.18 }));
        break;
      case 'chest':
        this._noise({ t, dur: 0.16, vol: 0.14, filter: 'bandpass', f0: 900, f1: 2600 });
        [784, 988, 1318].forEach((f, i) =>
          this._tone({ type: 'square', f0: f, t: t + 0.08 + i * 0.05, dur: 0.14, vol: 0.12 }));
        break;
      case 'door':
        [392, 523, 659, 784, 1046].forEach((f, i) =>
          this._tone({ type: 'square', f0: f, t: t + i * 0.07, dur: 0.2, vol: 0.16, detune: 6 }));
        break;
      case 'key':
        [1046, 1318, 1568, 2093].forEach((f, i) =>
          this._tone({ type: 'square', f0: f, t: t + i * 0.045, dur: 0.16, vol: 0.14 }));
        break;
      case 'bossHit':
        this._tone({ type: 'sawtooth', f0: 220, f1: 70, t, dur: 0.22, vol: 0.2, cutoff: 1200 });
        this._noise({ t, dur: 0.18, vol: 0.18, filter: 'lowpass', f0: 1400, f1: 200 });
        break;
      case 'bossDie':
        for (let i = 0; i < 6; i++) {
          this._noise({ t: t + i * 0.13, dur: 0.4, vol: 0.22, filter: 'lowpass', f0: 2400, f1: 120 });
          this._tone({ type: 'square', f0: 300 - i * 30, f1: 40, t: t + i * 0.13, dur: 0.4, vol: 0.13 });
        }
        break;
      case 'select':
        this._tone({ type: 'square', f0: 880, t, dur: 0.06, vol: 0.14 });
        break;
      case 'pause':
        this._tone({ type: 'square', f0: 660, t, dur: 0.06, vol: 0.13 });
        this._tone({ type: 'square', f0: 440, t: t + 0.07, dur: 0.08, vol: 0.13 });
        break;
      case 'charge':
        this._tone({ type: 'sawtooth', f0: 120, f1: 700, t, dur: 0.45, vol: 0.1, cutoff: 2200 });
        break;
      default:
        break;
    }
  }
}
