// ─── Carcinization sound ────────────────────────────────────────────────────
// Every sound in the takeover is synthesised on the spot: no audio files, no
// network. Browsers only let a page make noise after a user gesture, so the
// engine stays silent until unlock() runs inside one. The kernel panic's
// "press any key to reboot" is that gesture; skip it and the show runs mute.

const MASTER = 0.42;

type Ctx = { ctx: AudioContext; t: number; out: AudioNode; wet: AudioNode };

export class CarcSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wet: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private lastTick = 0;
  private lastPop = 0;

  /** Must run inside a click/keydown handler. Safe to call repeatedly. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();

        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 10;
        limiter.ratio.value = 8;
        limiter.connect(ctx.destination);

        const master = ctx.createGain();
        master.gain.value = this.muted ? 0 : MASTER;
        master.connect(limiter);

        const reverb = ctx.createConvolver();
        reverb.buffer = impulse(ctx, 3.2, 2.4);
        const wet = ctx.createGain();
        wet.gain.value = 0.5;
        reverb.connect(wet).connect(master);

        this.ctx = ctx;
        this.master = master;
        this.wet = reverb;
        this.noise = noiseBuffer(ctx, 2);
      }
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : MASTER,
        this.ctx.currentTime,
        0.06
      );
    }
  }

  /** Fade everything out, then release the audio device. */
  dispose(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = null;
    try {
      this.master?.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => void ctx.close().catch(() => {}), 700);
    } catch {
      void ctx.close().catch(() => {});
    }
  }

  private now(): Ctx | null {
    const { ctx, master, wet } = this;
    if (!ctx || !master || !wet || ctx.state !== "running") return null;
    return { ctx, t: ctx.currentTime + 0.005, out: master, wet };
  }

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  // ── Boot ──

  /** The CRT coming back: a thump and the mains hum settling. */
  powerOn(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out } = a;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.35);
    const g = env(ctx, t, 0.005, 0.5, 0.5);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.6);

    const hum = ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 60;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    const hg = env(ctx, t, 0.08, 0.05, 1.4);
    hum.connect(lp).connect(hg).connect(out);
    hum.start(t);
    hum.stop(t + 1.6);
  }

  /** The POST beep. One short beep: all systems nominal. */
  beep(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out } = a;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = 988;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.004);
    g.gain.setValueAtTime(0.07, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 0.17);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** A relay-click as each boot line lands. */
  click(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out } = a;
    const src = this.noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = "bandpass";
    hp.frequency.value = 2400 + Math.random() * 1600;
    hp.Q.value = 1.4;
    const g = env(ctx, t, 0.001, 0.22, 0.035);
    src.connect(hp).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  /** Two-tone klaxon for "CARCINIZATION PROTOCOL ... ARMED". */
  alarm(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    for (let i = 0; i < 4; i++) {
      o.frequency.setValueAtTime(i % 2 ? 392 : 523, t + i * 0.16);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.02);
    g.gain.setValueAtTime(0.06, t + 0.6);
    g.gain.linearRampToValueAtTime(0, t + 0.7);
    o.connect(lp).connect(g);
    g.connect(out);
    g.connect(wet);
    o.start(t);
    o.stop(t + 0.75);
  }

  // ── Replay ──

  /** One day of the run lighting up. Pitch climbs with progress (0-1). */
  tick(progress: number): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;
    if (t - this.lastTick < 0.03) return;
    this.lastTick = t;
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 330 * Math.pow(2, progress * 2.6);
    const g = env(ctx, t, 0.002, 0.07, 0.07);
    o.connect(g);
    g.connect(out);
    g.connect(wet);
    o.start(t);
    o.stop(t + 0.1);
  }

  /** Tension under the fast half of the replay. Returns a hard cut. */
  riser(duration: number): () => void {
    const a = this.now();
    if (!a) return () => {};
    const { ctx, t, out, wet } = a;
    const end = t + duration;

    const src = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(6200, end);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.32, end);
    src.connect(bp).connect(ng);

    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(55, t);
    saw.frequency.exponentialRampToValueAtTime(330, end);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(2400, end);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.09, end);
    saw.connect(lp).connect(sg);

    const bus = ctx.createGain();
    ng.connect(bus);
    sg.connect(bus);
    bus.connect(out);
    bus.connect(wet);
    src.start(t);
    saw.start(t);

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0, now + 0.03);
      src.stop(now + 0.05);
      saw.stop(now + 0.05);
    };
  }

  // ── The big bang ──

  impact(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;

    // Sub drop
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(120, t);
    sub.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    const sg = env(ctx, t, 0.004, 0.95, 2.4);
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(t + 2.6);

    // Body: filtered noise with a long tail
    const body = this.noiseSource(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(160, t + 1.8);
    const bg = env(ctx, t, 0.003, 0.6, 2.2);
    body.connect(lp).connect(bg);
    bg.connect(out);
    bg.connect(wet);
    body.start(t);
    body.stop(t + 2.4);

    // Crack
    const crack = this.noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const cg = env(ctx, t, 0.001, 0.5, 0.12);
    crack.connect(hp).connect(cg).connect(out);
    crack.start(t, 0.3);
    crack.stop(t + 0.2);
  }

  /** Hyperspace: a rushing sweep with a rumble under it. */
  warp(duration: number): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;
    const src = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + duration * 0.45);
    bp.frequency.exponentialRampToValueAtTime(260, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + duration * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(bp).connect(g);
    g.connect(out);
    g.connect(wet);
    src.start(t, 0.7);
    src.stop(t + duration + 0.05);

    const rum = ctx.createOscillator();
    rum.type = "sawtooth";
    rum.frequency.setValueAtTime(38, t);
    rum.frequency.linearRampToValueAtTime(55, t + duration);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0001, t);
    rg.gain.exponentialRampToValueAtTime(0.18, t + duration * 0.35);
    rg.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    rum.connect(lp).connect(rg).connect(out);
    rum.start(t);
    rum.stop(t + duration + 0.05);
  }

  // ── CLAWD PRIME ──

  /** The deity's presence: a slow, detuned low choir. Returns a fade-out. */
  drone(): (fade?: number) => void {
    const a = this.now();
    if (!a) return () => {};
    const { ctx, t, out, wet } = a;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.11, t + 2.5);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    lp.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 160;
    lfo.connect(lfoDepth).connect(lp.frequency);

    const oscs = [55, 55.35, 82.41, 110.2].map((f) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      return o;
    });
    lp.connect(bus);
    bus.connect(out);
    bus.connect(wet);
    lfo.start(t);
    oscs.forEach((o) => o.start(t));

    let stopped = false;
    return (fade = 1.2) => {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now);
      bus.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      lfo.stop(now + fade + 0.05);
      oscs.forEach((o) => o.stop(now + fade + 0.05));
    };
  }

  /** CLAWD PRIME speaks: a formant growl, pulsing like syllables. */
  speak(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;
    const dur = 1.5;
    const src = ctx.createOscillator();
    src.type = "sawtooth";
    src.frequency.setValueAtTime(62, t);
    src.frequency.linearRampToValueAtTime(52, t + dur);

    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 480;
    f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 880;
    f2.Q.value = 7;

    const syllables = ctx.createGain();
    syllables.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(syllables.gain);
    const bias = ctx.createConstantSource();
    bias.offset.value = 0.5;
    bias.connect(syllables.gain);

    const g = env(ctx, t, 0.08, 0.5, dur);
    src.connect(f1).connect(syllables);
    src.connect(f2).connect(syllables);
    syllables.connect(g);
    g.connect(out);
    g.connect(wet);
    [src, lfo, bias].forEach((n) => {
      n.start(t);
      n.stop(t + dur + 0.1);
    });
  }

  /** The deity pouring into the avatar: a rising glitter. */
  absorb(duration: number): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + duration * 0.9);
    g.gain.linearRampToValueAtTime(0, t + duration);
    o.connect(g);
    g.connect(out);
    g.connect(wet);
    o.start(t);
    o.stop(t + duration + 0.05);

    for (let i = 0; i < 18; i++) {
      const at = t + (i / 18) * duration;
      const b = ctx.createOscillator();
      b.type = "sine";
      b.frequency.value = 1200 + i * 140 + Math.random() * 300;
      const bg = env(ctx, at, 0.002, 0.035, 0.18);
      b.connect(bg).connect(wet);
      b.start(at);
      b.stop(at + 0.22);
    }
  }

  // ── Coronation ──

  /** D major, add nine, opening like a curtain. Bells on top. */
  fanfare(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(320, t);
    lp.frequency.exponentialRampToValueAtTime(4200, t + 1.4);
    lp.frequency.exponentialRampToValueAtTime(1600, t + 5);
    const pad = ctx.createGain();
    pad.gain.setValueAtTime(0.0001, t);
    pad.gain.exponentialRampToValueAtTime(0.16, t + 0.12);
    pad.gain.setValueAtTime(0.16, t + 1.6);
    pad.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
    lp.connect(pad);
    pad.connect(out);
    pad.connect(wet);

    for (const f of [73.42, 146.83, 220, 293.66, 369.99, 440, 659.25]) {
      for (const cents of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(t);
        o.stop(t + 6.6);
      }
    }

    [587.33, 739.99, 880, 1174.66, 1479.98, 1760, 2349.32].forEach((f, i) => {
      const at = t + 0.25 + i * 0.085;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = "triangle";
      o2.frequency.value = f * 2;
      const g = env(ctx, at, 0.002, 0.06, 1.3);
      const g2 = env(ctx, at, 0.002, 0.015, 0.5);
      o.connect(g);
      o2.connect(g2);
      g.connect(out);
      g.connect(wet);
      g2.connect(wet);
      o.start(at);
      o2.start(at);
      o.stop(at + 1.4);
      o2.stop(at + 0.6);
    });
  }

  /** The title landing. */
  thud(): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out } = a;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const g = env(ctx, t, 0.002, 0.6, 0.6);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.7);
  }

  /** A firework: the burst, then a scatter of crackle. */
  pop(pan = 0): void {
    const a = this.now();
    if (!a) return;
    const { ctx, t, out, wet } = a;
    if (t - this.lastPop < 0.08) return;
    this.lastPop = t;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    panner.connect(out);
    panner.connect(wet);

    const burst = this.noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = "lowpass";
    bp.frequency.value = 900;
    const g = env(ctx, t, 0.002, 0.3, 0.35);
    burst.connect(bp).connect(g).connect(panner);
    burst.start(t, Math.random());
    burst.stop(t + 0.4);

    for (let i = 0; i < 10; i++) {
      const at = t + 0.12 + Math.random() * 0.7;
      const c = this.noiseSource(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3500;
      const cg = env(ctx, at, 0.001, 0.05, 0.02);
      c.connect(hp).connect(cg).connect(panner);
      c.start(at, Math.random());
      c.stop(at + 0.04);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Attack-decay envelope on a fresh gain node. */
function env(
  ctx: AudioContext,
  t: number,
  attack: number,
  peak: number,
  decay: number
): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** A synthetic hall: stereo noise with an exponential tail. */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}
