// Ironworks Protocol — all sound is synthesised with WebAudio: no audio files,
// no network. Each weapon has its own crack, footsteps tap, reload clicks, the
// bomb beeps faster as it nears detonation, and round stingers mark wins/losses.

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  _noise({ dur, freq, q = 1, gain = 0.5, type = 'bandpass', sweepTo = null, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type; filter.frequency.setValueAtTime(freq, t0); filter.Q.value = q;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  _tone({ freq, dur, gain = 0.2, type = 'sine', slideTo = null, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  shot(kind, distance = 0) {
    this.ensure();
    const atten = Math.max(0.15, 1 - distance / 70);
    switch (kind) {
      case 'pistol': this._noise({ dur: 0.09, freq: 1800, gain: 0.5 * atten, sweepTo: 300 }); break;
      case 'smg': this._noise({ dur: 0.07, freq: 2200, gain: 0.38 * atten, sweepTo: 400 }); break;
      case 'rifle': this._noise({ dur: 0.12, freq: 1400, gain: 0.55 * atten, sweepTo: 220 }); this._tone({ freq: 180, dur: 0.08, gain: 0.25 * atten, type: 'square', slideTo: 90 }); break;
      case 'shotgun': this._noise({ dur: 0.22, freq: 900, gain: 0.7 * atten, sweepTo: 140, type: 'lowpass' }); break;
      case 'dmr': this._noise({ dur: 0.2, freq: 2600, gain: 0.6 * atten, sweepTo: 200 }); this._tone({ freq: 120, dur: 0.14, gain: 0.3 * atten, type: 'square', slideTo: 60 }); break;
      case 'lmg': this._noise({ dur: 0.1, freq: 1100, gain: 0.5 * atten, sweepTo: 260 }); break;
      default: this._noise({ dur: 0.1, freq: 1500, gain: 0.4 * atten, sweepTo: 300 });
    }
  }

  dryFire() { this._tone({ freq: 1200, dur: 0.03, gain: 0.12, type: 'square' }); }
  reload() {
    this._tone({ freq: 900, dur: 0.04, gain: 0.16, type: 'square' });
    this._tone({ freq: 600, dur: 0.05, gain: 0.16, type: 'square', delay: 0.28 });
    this._tone({ freq: 1100, dur: 0.04, gain: 0.18, type: 'square', delay: 0.55 });
  }
  step(run) { this._noise({ dur: 0.05, freq: run ? 500 : 380, gain: run ? 0.1 : 0.07, sweepTo: 180 }); }
  hit() { this._tone({ freq: 2400, dur: 0.05, gain: 0.18, type: 'square' }); }
  kill() {
    this._tone({ freq: 2400, dur: 0.05, gain: 0.2, type: 'square' });
    this._tone({ freq: 1800, dur: 0.07, gain: 0.2, type: 'square', delay: 0.06 });
  }
  hurt() { this._tone({ freq: 140, dur: 0.16, gain: 0.3, type: 'sawtooth', slideTo: 70 }); }
  explosion() {
    this._noise({ dur: 0.9, freq: 500, gain: 0.9, sweepTo: 60, type: 'lowpass' });
    this._tone({ freq: 60, dur: 0.7, gain: 0.5, type: 'sine', slideTo: 30 });
  }
  beep(urgent) { this._tone({ freq: urgent ? 1500 : 1050, dur: urgent ? 0.09 : 0.12, gain: 0.16 }); }
  plant() { this._tone({ freq: 700, dur: 0.1, gain: 0.18 }); this._tone({ freq: 1050, dur: 0.14, gain: 0.18, delay: 0.12 }); }
  defuse() { this._tone({ freq: 1050, dur: 0.1, gain: 0.18 }); this._tone({ freq: 1400, dur: 0.16, gain: 0.18, delay: 0.12 }); }
  roundStart() { this._tone({ freq: 440, dur: 0.12, gain: 0.2 }); this._tone({ freq: 660, dur: 0.16, gain: 0.2, delay: 0.12 }); }
  roundWon() {
    [523, 659, 784].forEach((f, i) => this._tone({ freq: f, dur: 0.18, gain: 0.2, delay: i * 0.11 }));
  }
  roundLost() {
    [392, 330, 262].forEach((f, i) => this._tone({ freq: f, dur: 0.2, gain: 0.2, delay: i * 0.13 }));
  }
  buy() { this._tone({ freq: 880, dur: 0.06, gain: 0.15 }); this._tone({ freq: 1320, dur: 0.08, gain: 0.15, delay: 0.06 }); }
  denied() { this._tone({ freq: 220, dur: 0.12, gain: 0.18, type: 'square' }); }
}
