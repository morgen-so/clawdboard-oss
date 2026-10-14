// ─── Eternal stage ──────────────────────────────────────────────────────────
// The canvas behind the 100-day celebration. A dial of 100 ticks, one per day,
// lights up in the colour of each tier the run passed through on the way
// (Spark, Flame, Fire, Blaze, Inferno), holds its breath at 99, and goes off
// at 100: the ticks blow out as gold sparks and the dial whips round, re-formed
// as the spinning gold halo of the Eternal aura.
//
// The DOM layers (the counter, the card) sit on top; this only paints light,
// and moves the dial element so the two stay in register. Same cheap bloom and
// frame-time governor as the Carcinization stage, and the same clock: it only
// advances by frames rendered, so a hidden tab pauses the show.

import { getStreakTier } from "@/lib/streak-tiers";
import type { CarcSound } from "../carcinization/sound";

export type EternalPhase = "count" | "hold" | "burst" | "crown";

/** Ticks on the dial: one per day, up to the Eternal tier. */
export const DIAL_DAYS = 100;

// ─── Timeline (stage seconds) ───────────────────────────────────────────────

/** Day 1 lights. */
const COUNT_AT = 0.6;
/** Day 1 to day 99. */
const COUNT_DUR = 2.1;
/** 99: the hit-stop before the hundredth. */
const HOLD_AT = COUNT_AT + COUNT_DUR + 0.05;
const BURST_AT = HOLD_AT + 0.75;
/** The dial rises from the middle of the screen to its place in the card. */
const LIFT_AT = BURST_AT + 0.2;
const LIFT_DUR = 1;
/** The card starts to come in. */
const CROWN_AT = BURST_AT + 0.55;
/** Motion trails while the burst is fast. */
const TRAILS_END = BURST_AT + 1.3;

/** Day 1 slow as a heartbeat; by the nineties, several days a frame. */
function igniteAt(day: number): number {
  return COUNT_AT + COUNT_DUR * Math.pow((day - 1) / (DIAL_DAYS - 2), 0.55);
}

/** Day 1 at twelve o'clock, clockwise. */
function angleOf(day: number): number {
  return -Math.PI / 2 + ((day - 1) / DIAL_DAYS) * Math.PI * 2;
}

// ─── Colour ─────────────────────────────────────────────────────────────────

/** Each day's tick takes the colour of the tier the run was in that day. */
const DAY_COLOR = Array.from(
  { length: DIAL_DAYS + 1 },
  (_, day) => getStreakTier(Math.max(2, day)).staticRingColor
);

/** Days the run went up a tier, after Spark: each gets a shockwave. */
const TIER_UPS = Array.from({ length: DIAL_DAYS - 1 }, (_, i) => i + 1).filter(
  (day) => day > 2 && getStreakTier(day).tier !== getStreakTier(day - 1).tier
);

const GOLD = DAY_COLOR[DIAL_DAYS];
const PALE_GOLD = "#fde047";
const PURPLE = "#c084fc";
const BURST_COLORS = ["#FFFFFF", "#FFF4D6", PALE_GOLD, GOLD, GOLD, "#F9A615", PURPLE];
const EMBER_COLORS = [GOLD, PALE_GOLD, "#F9A615", "#FFF4D6", PURPLE];
const GLINT_COLORS = ["#FFFFFF", "#FFF4D6", PALE_GOLD];

/** Beads that circle the halo once it's crowned. */
const ORBITERS = [
  { r: 1.16, speed: 1.15, phase: 0, color: "#FFF4D6", size: 1 },
  { r: 1.3, speed: -0.72, phase: 2.1, color: GOLD, size: 0.8 },
  { r: 0.9, speed: 1.7, phase: 4.2, color: PURPLE, size: 0.7 },
];

const MAX_SPARKS = 2600;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** A soft round glow in one colour, white at the core. Cached per colour. */
const glowSprites = new Map<string, HTMLCanvasElement>();
function glowSprite(color: string): HTMLCanvasElement {
  const cached = glowSprites.get(color);
  if (cached) return cached;
  const S = 64;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.15, `rgba(${rgb(color)},0.9)`);
  grad.addColorStop(0.45, `rgba(${rgb(color)},0.25)`);
  grad.addColorStop(1, `rgba(${rgb(color)},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  glowSprites.set(color, c);
  return c;
}

/** God rays: alternating wide and narrow beams on a radial falloff. */
function buildRays(canvas: HTMLCanvasElement): void {
  const S = 512;
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext("2d")!;
  const c = S / 2;
  const beams = 24;
  for (let k = 0; k < beams; k++) {
    const a = (k / beams) * Math.PI * 2;
    const w = k % 2 === 0 ? 0.11 : 0.04;
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c, a - w / 2, a + w / 2);
    g.closePath();
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, "rgba(255,244,214,0.5)");
    grad.addColorStop(0.3, `rgba(${rgb(GOLD)},0.14)`);
    grad.addColorStop(1, `rgba(${rgb(GOLD)},0)`);
    g.fillStyle = grad;
    g.fill();
  }
}

interface Ring {
  x: number;
  y: number;
  r: number;
  v: number;
  width: number;
  life: number;
  max: number;
  color: string;
  alpha: number;
}

interface Glint {
  x: number;
  y: number;
  size: number;
  life: number;
  max: number;
  rot: number;
  color: string;
}

export interface EternalStageOptions {
  /** The dial in the DOM. The stage draws around it and scales it. */
  dialEl: HTMLElement;
  /** Moved to centre the dial for the count, then lifted back into the card. */
  liftEl: HTMLElement;
  /** Shaken along with the canvas. */
  shakeEl: HTMLElement | null;
  sound: CarcSound;
  /** The latest day lit, at most once a frame. */
  onDay: (day: number) => void;
  onPhase: (phase: EternalPhase) => void;
}

// ─── Stage ──────────────────────────────────────────────────────────────────

export class EternalStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scene = document.createElement("canvas");
  private readonly sctx: CanvasRenderingContext2D;
  private readonly bloomA = document.createElement("canvas");
  private readonly bloomB = document.createElement("canvas");
  private readonly actx: CanvasRenderingContext2D;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly rays = document.createElement("canvas");
  private readonly opts: EternalStageOptions;

  private W = 0;
  private H = 0;
  private dpr = 1;
  private quality = 2; // 2 = bloom, 1 = no bloom, 0 = no bloom at 1x
  private slowFrames = 0;
  private raf = 0;
  private last = 0;
  /** Stage time in seconds: frames rendered, not wall clock. */
  private t = 0;
  private destroyed = false;
  private phase: EternalPhase = "count";

  // The dial, in CSS px on the canvas
  private cx = 0;
  private cy = 0;
  private R = 100;
  /** R relative to a desktop dial, for speeds and sizes. */
  private unit = 1;
  private lift = 0;
  private scale = 1;
  private spin = 0;
  private shimmer = 0;
  private lit = 0;
  private readonly litAt = new Float32Array(DIAL_DAYS + 1).fill(-99);

  private shakeAmp = 0;
  private flashAt = -99;
  private flashPower = 0;
  private raysAt = Infinity; // no rays until the burst
  private beatAt = -99;
  private riserStop: (() => void) | null = null;

  private gatherDebt = 0;
  private emberDebt = 0;
  private nextGlint = 0;
  private nextBeat = 0;
  private pendingBeat = -1;

  // Sparks (struct of arrays, swap-remove)
  private sparkCount = 0;
  private readonly sX = new Float32Array(MAX_SPARKS);
  private readonly sY = new Float32Array(MAX_SPARKS);
  private readonly sVX = new Float32Array(MAX_SPARKS);
  private readonly sVY = new Float32Array(MAX_SPARKS);
  private readonly sLife = new Float32Array(MAX_SPARKS);
  private readonly sMax = new Float32Array(MAX_SPARKS);
  private readonly sSize = new Float32Array(MAX_SPARKS);
  private readonly sDrag = new Float32Array(MAX_SPARKS);
  private readonly sGrav = new Float32Array(MAX_SPARKS);
  private readonly sColor = new Uint8Array(MAX_SPARKS);
  /** Fades in rather than starting at full brightness (ambient embers). */
  private readonly sSoft = new Uint8Array(MAX_SPARKS);
  private readonly palette: string[] = [];

  private rings: Ring[] = [];
  private glints: Glint[] = [];

  constructor(canvas: HTMLCanvasElement, opts: EternalStageOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.ctx = canvas.getContext("2d")!;
    this.sctx = this.scene.getContext("2d")!;
    this.actx = this.bloomA.getContext("2d")!;
    this.bctx = this.bloomB.getContext("2d")!;
    buildRays(this.rays);
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  start(): void {
    this.last = performance.now();
    this.t = 0;
    this.opts.onDay(0);
    // Centre the dial before the first paint, not on the first frame.
    this.measure();
    this.place();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.riserStop?.();
    const { shakeEl, liftEl, dialEl } = this.opts;
    if (shakeEl) shakeEl.style.transform = "";
    liftEl.style.transform = "";
    dialEl.style.transform = "";
  }

  /** Jump straight to the hundredth day. */
  skip(): void {
    if (this.phase !== "count" && this.phase !== "hold") return;
    this.riserStop?.();
    this.riserStop = null;
    this.lit = DIAL_DAYS - 1;
    this.litAt.fill(-99);
    this.gatherDebt = 0;
    this.phase = "hold";
    this.t = BURST_AT;
    this.opts.onDay(this.lit);
  }

  // ── Setup ──

  private resize = (): void => {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.dpr = this.quality > 0 ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const w = Math.round(this.W * this.dpr);
    const h = Math.round(this.H * this.dpr);
    for (const c of [this.canvas, this.scene]) {
      c.width = w;
      c.height = h;
    }
    this.bloomA.width = Math.max(1, Math.round(w / 4));
    this.bloomA.height = Math.max(1, Math.round(h / 4));
    this.bloomB.width = Math.max(1, Math.round(w / 16));
    this.bloomB.height = Math.max(1, Math.round(h / 16));
  };

  /**
   * Where the dial is laid out, net of the stage's own transforms, and where it
   * should be this frame: the middle of the screen for the count, then lifted
   * to its place at the top of the card.
   */
  private measure(): void {
    const { dialEl } = this.opts;
    const c = this.canvas.getBoundingClientRect();
    const d = dialEl.getBoundingClientRect();
    // offsetWidth ignores the scale the stage puts on the dial.
    this.R = (dialEl.offsetWidth / 2) * 0.84;
    this.unit = this.R / 150;
    this.cx = d.left + d.width / 2 - c.left;
    const restY = d.top + d.height / 2 - c.top - this.lift;
    const u = easeInOut(clamp01((this.t - LIFT_AT) / LIFT_DUR));
    this.lift = (this.H / 2 - restY) * (1 - u);
    this.cy = restY + this.lift;
  }

  /** Puts the DOM where the canvas thinks it is. */
  private place(): void {
    const { liftEl, dialEl } = this.opts;
    liftEl.style.transform =
      Math.abs(this.lift) > 0.5 ? `translate3d(0, ${this.lift.toFixed(1)}px, 0)` : "";
    dialEl.style.transform =
      Math.abs(this.scale - 1) > 0.002 ? `scale(${this.scale.toFixed(4)})` : "";
  }

  // ── Frame ──

  private frame = (now: number): void => {
    if (this.destroyed) return;
    // A long gap means the tab was hidden: carry on from where it stopped.
    const gap = (now - this.last) / 1000;
    const dt = gap > 0.25 ? 1 / 60 : Math.min(0.1, Math.max(0.0001, gap));
    this.last = now;
    this.t += dt;
    this.govern(dt);

    this.measure();
    this.update(dt);
    this.place();
    this.updateShake(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Drop bloom, then resolution, if frames keep running long. */
  private govern(dt: number): void {
    if (this.quality === 0) return;
    this.slowFrames = dt > 1 / 38 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 50) {
      this.quality -= 1;
      this.slowFrames = 0;
      if (this.quality === 0) this.resize();
    }
  }

  private shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  private updateShake(dt: number): void {
    const el = this.opts.shakeEl;
    if (this.shakeAmp > 0.15) {
      const a = this.shakeAmp;
      const x = (Math.random() * 2 - 1) * a;
      const y = (Math.random() * 2 - 1) * a;
      if (el) el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      this.shakeAmp *= Math.exp(-dt * 7);
    } else if (this.shakeAmp > 0) {
      this.shakeAmp = 0;
      if (el) el.style.transform = "";
    }
  }

  private setPhase(phase: EternalPhase): void {
    this.phase = phase;
    this.opts.onPhase(phase);
  }

  private update(dt: number): void {
    const t = this.t;
    const { sound } = this.opts;

    if (this.phase === "count" || this.phase === "hold") {
      let day = this.lit;
      while (day < DIAL_DAYS - 1 && t >= igniteAt(day + 1)) this.ignite(++day);
      if (day !== this.lit) {
        this.lit = day;
        this.opts.onDay(day);
      }
    }
    if (this.phase === "count" && t >= HOLD_AT) {
      this.setPhase("hold");
      this.riserStop = sound.riser(BURST_AT - HOLD_AT);
    }
    if (this.phase === "hold" && t >= BURST_AT) this.burst();
    if (this.phase === "burst" && t >= CROWN_AT) {
      this.setPhase("crown");
      sound.fanfare();
    }

    // The dial clenches through the hold, then springs out past full size.
    if (t < HOLD_AT) {
      this.scale = 1;
    } else if (this.phase === "hold") {
      const h = clamp01((t - HOLD_AT) / (BURST_AT - HOLD_AT));
      this.scale = 1 - 0.1 * h * h;
      this.spin = -0.07 * h * h; // wind-up
      this.shake(5 * h);
    } else {
      const k = t - BURST_AT;
      this.scale = 1 + 0.3 * Math.exp(-4.5 * k) * Math.sin(11 * k - 0.34);
    }

    // Light pours in from the edges, faster as the count runs out.
    if (this.phase === "count" || this.phase === "hold") {
      const holding = this.phase === "hold";
      const p = clamp01((t - COUNT_AT) / (HOLD_AT - COUNT_AT));
      this.gatherDebt += (holding ? 520 : t < COUNT_AT ? 0 : 25 + 170 * p * p) * dt;
      while (this.gatherDebt >= 1) {
        this.gatherDebt -= 1;
        this.gather(holding);
      }
    } else {
      this.ambient(dt);
    }

    this.updateSparks(dt);
    this.updateRings(dt);
    this.updateGlints(dt);
  }

  // ── Count ──

  private ignite(day: number): void {
    this.litAt[day] = igniteAt(day);
    const a = angleOf(day) + this.spin;
    const r = this.R * this.scale;
    const x = this.cx + Math.cos(a) * r;
    const y = this.cy + Math.sin(a) * r;
    const color = DAY_COLOR[day];
    for (let i = 0; i < 3; i++) {
      const sa = a + rand(-0.3, 0.3);
      const sp = rand(60, 240) * this.unit;
      this.spawn(x, y, Math.cos(sa) * sp, Math.sin(sa) * sp, rand(0.35, 0.7), rand(1.2, 2.2), 2.5, 0, i === 0 ? "#FFFFFF" : color);
    }
    this.opts.sound.tick(day / (DIAL_DAYS - 1));
    if (TIER_UPS.includes(day)) this.tierUp(day);
  }

  /** A new tier: a shockwave in its colour, harder each time. */
  private tierUp(day: number): void {
    const color = DAY_COLOR[day];
    const n = TIER_UPS.indexOf(day) + 1;
    const { cx, cy, R, unit } = this;
    this.addRing(cx, cy, R * 0.3, R * 3.4, 3 + n, 0.75, color, 0.85);
    this.shake(1.5 + n);
    for (let i = 0; i < 16 + n * 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(140, 460) * unit;
      this.spawn(cx + Math.cos(a) * R, cy + Math.sin(a) * R, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.5, 0.95), rand(1.2, 2.4), 2.2, 30 * unit, color);
    }
    this.opts.sound.thud();
  }

  /** One mote of light falling in towards the dial from somewhere off in the dark. */
  private gather(fast: boolean): void {
    const a = Math.random() * Math.PI * 2;
    const far = Math.hypot(this.W, this.H) * 0.55;
    const r0 = rand(this.R * 1.7, Math.max(this.R * 1.9, far));
    const target = this.R * 1.08 * this.scale;
    const speed = (fast ? rand(0.9, 1.5) : rand(0.25, 0.55)) * far;
    const swirl = 0.3;
    const dir = a + Math.PI + swirl;
    const color =
      Math.random() < 0.5 ? DAY_COLOR[Math.max(1, this.lit)] : pick(["#FFF4D6", "#FBC15B"]);
    this.spawn(
      this.cx + Math.cos(a) * r0,
      this.cy + Math.sin(a) * r0,
      Math.cos(dir) * speed,
      Math.sin(dir) * speed,
      (r0 - target) / (speed * Math.cos(swirl)),
      rand(1, 2.2),
      0,
      0,
      color
    );
  }

  // ── The hundredth ──

  private burst(): void {
    const { cx, cy, R, unit } = this;
    this.setPhase("burst");
    this.lit = DIAL_DAYS;
    this.litAt[DIAL_DAYS] = this.t;
    this.opts.onDay(DIAL_DAYS);
    this.riserStop?.();
    this.riserStop = null;
    this.opts.sound.impact();

    this.flashAt = this.t;
    this.flashPower = 0.85;
    this.shake(18);
    this.raysAt = this.t;
    this.nextGlint = this.t + 0.5;
    this.nextBeat = this.t + 1.8;

    this.addRing(cx, cy, R * 0.9, R * 8, 16, 0.55, "#FFFFFF", 1);
    this.addRing(cx, cy, R * 0.9, R * 5.5, 9, 0.95, GOLD, 1);
    this.addRing(cx, cy, R * 0.8, R * 3.6, 5, 1.3, PURPLE, 0.9);
    this.addRing(cx, cy, R * 0.5, R * 2.2, 3, 1.6, PALE_GOLD, 0.7);

    // Every tick blows outward along its own spoke...
    for (let day = 1; day <= DIAL_DAYS; day++) {
      const a = angleOf(day) + this.spin;
      const x = cx + Math.cos(a) * R * 0.9;
      const y = cy + Math.sin(a) * R * 0.9;
      for (let i = 0; i < 7; i++) {
        const sa = a + rand(-0.14, 0.14);
        const sp = rand(260, 1150) * unit;
        this.spawn(x, y, Math.cos(sa) * sp, Math.sin(sa) * sp, rand(0.9, 2.1), rand(1.3, 3), rand(1.6, 2.8), 45 * unit, pick(BURST_COLORS));
      }
    }
    // ...and glitter hangs in the air where it was.
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R;
      const sp = rand(60, 420) * unit;
      this.spawn(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp, rand(1.8, 3.4), rand(0.9, 2), 1.2, 25 * unit, pick(BURST_COLORS));
    }
  }

  // ── Crown ──

  private ambient(dt: number): void {
    const t = this.t;
    const k = t - BURST_AT;
    const { cx, cy, R, unit } = this;

    // The halo whips round after the burst, then settles into the aura's spin.
    this.spin += dt * (0.25 + 2.2 * Math.exp(-2.5 * k));
    this.shimmer += dt * 2.4;

    // Embers drifting up through the dark
    this.emberDebt += dt * 18 * clamp01(k / 1.5);
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.spawn(rand(0, this.W), rand(this.H * 0.25, this.H + 8), rand(-14, 14), rand(-80, -28), rand(5, 9), rand(1, 2.4), 0, -5, pick(EMBER_COLORS), true);
    }

    if (t >= this.nextGlint) {
      this.nextGlint = t + rand(0.12, 0.42);
      this.glint();
    }

    // A heartbeat, lub-dub, every few seconds
    if (t >= this.nextBeat) {
      this.nextBeat = t + 2.8;
      this.pendingBeat = t + 0.22;
      this.heartbeat(1);
    }
    if (this.pendingBeat > 0 && t >= this.pendingBeat) {
      this.pendingBeat = -1;
      this.heartbeat(0.6);
    }

    // Comet tails behind the orbiting beads
    if (k < 0.3) return;
    for (const o of ORBITERS) {
      const a = o.phase + t * o.speed;
      const r = R * o.r;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      this.spawn(x, y, -Math.sin(a) * o.speed * 8 * unit, Math.cos(a) * o.speed * 8 * unit, 0.5, 1.8 * o.size * unit + 0.6, 0, 0, o.color);
    }
  }

  private heartbeat(power: number): void {
    this.beatAt = this.t;
    this.addRing(this.cx, this.cy, this.R * 1.02, this.R * 1.3, 2.5, 1.4, GOLD, 0.45 * power);
  }

  private glint(): void {
    const a = Math.random() * Math.PI * 2;
    const near = Math.random() < 0.6;
    const r = near
      ? this.R * rand(1.15, 1.6)
      : rand(this.R * 1.6, Math.hypot(this.W, this.H) * 0.5);
    let x = this.cx + Math.cos(a) * r;
    let y = this.cy + Math.sin(a) * r;
    if (x < 0 || x > this.W || y < 0 || y > this.H) {
      x = rand(0, this.W);
      y = rand(0, this.H);
    }
    const life = rand(0.7, 1.2);
    this.glints.push({
      x,
      y,
      size: rand(5, 13) * Math.max(0.7, this.unit) * (near ? 1 : 0.8),
      life,
      max: life,
      rot: rand(-0.3, 0.3),
      color: pick(GLINT_COLORS),
    });
  }

  // ── Particles ──

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, drag: number, grav: number, color: string, soft = false): void {
    let c = this.palette.indexOf(color);
    if (c < 0) c = this.palette.push(color) - 1;
    // Full: recycle a random slot rather than drop the newest.
    const i = this.sparkCount < MAX_SPARKS ? this.sparkCount++ : Math.floor(Math.random() * MAX_SPARKS);
    this.sX[i] = x;
    this.sY[i] = y;
    this.sVX[i] = vx;
    this.sVY[i] = vy;
    this.sLife[i] = life;
    this.sMax[i] = life;
    this.sSize[i] = size;
    this.sDrag[i] = drag;
    this.sGrav[i] = grav;
    this.sColor[i] = c;
    this.sSoft[i] = soft ? 1 : 0;
  }

  private updateSparks(dt: number): void {
    let i = 0;
    while (i < this.sparkCount) {
      this.sLife[i] -= dt;
      if (this.sLife[i] <= 0) {
        const j = --this.sparkCount;
        this.sX[i] = this.sX[j];
        this.sY[i] = this.sY[j];
        this.sVX[i] = this.sVX[j];
        this.sVY[i] = this.sVY[j];
        this.sLife[i] = this.sLife[j];
        this.sMax[i] = this.sMax[j];
        this.sSize[i] = this.sSize[j];
        this.sDrag[i] = this.sDrag[j];
        this.sGrav[i] = this.sGrav[j];
        this.sColor[i] = this.sColor[j];
        this.sSoft[i] = this.sSoft[j];
        continue;
      }
      const d = Math.exp(-this.sDrag[i] * dt);
      this.sVX[i] *= d;
      this.sVY[i] = this.sVY[i] * d + this.sGrav[i] * dt;
      this.sX[i] += this.sVX[i] * dt;
      this.sY[i] += this.sVY[i] * dt;
      i++;
    }
  }

  private addRing(x: number, y: number, r: number, v: number, width: number, life: number, color: string, alpha: number): void {
    this.rings.push({ x, y, r, v, width, life, max: life, color, alpha });
  }

  private updateRings(dt: number): void {
    for (let r = this.rings.length - 1; r >= 0; r--) {
      const ring = this.rings[r];
      ring.life -= dt;
      if (ring.life <= 0) {
        this.rings.splice(r, 1);
        continue;
      }
      ring.r += ring.v * dt;
      ring.v *= Math.exp(-dt * 1.6);
    }
  }

  private updateGlints(dt: number): void {
    for (let g = this.glints.length - 1; g >= 0; g--) {
      this.glints[g].life -= dt;
      if (this.glints[g].life <= 0) this.glints.splice(g, 1);
    }
  }

  // ── Draw ──

  private draw(): void {
    const s = this.sctx;
    const d = this.dpr;
    const t = this.t;

    // The scene: everything that glows. Trails only while the burst is fast.
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    if (t >= BURST_AT && t < TRAILS_END) {
      s.globalCompositeOperation = "destination-out";
      s.globalAlpha = 0.35;
      s.fillRect(0, 0, this.scene.width, this.scene.height);
      s.globalAlpha = 1;
    } else {
      s.clearRect(0, 0, this.scene.width, this.scene.height);
    }
    s.globalCompositeOperation = "lighter";
    s.setTransform(d, 0, 0, d, 0, 0);
    this.drawCore(s);
    this.drawDial(s);
    this.drawSparks(s);
    this.drawRings(s);
    this.drawGlints(s);
    this.drawOrbiters(s);

    // The backdrop goes straight onto the visible canvas: in the trail buffer
    // it would pile up frame on frame.
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(d, 0, 0, d, 0, 0);
    this.drawRays(c);

    // Then the scene, and its bloom, added on top.
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "lighter";
    c.drawImage(this.scene, 0, 0);
    if (this.quality >= 2) {
      this.actx.globalCompositeOperation = "copy";
      this.actx.imageSmoothingQuality = "high";
      this.actx.drawImage(this.scene, 0, 0, this.bloomA.width, this.bloomA.height);
      this.bctx.globalCompositeOperation = "copy";
      this.bctx.drawImage(this.bloomA, 0, 0, this.bloomB.width, this.bloomB.height);
      c.globalAlpha = 0.45;
      c.drawImage(this.bloomA, 0, 0, this.canvas.width, this.canvas.height);
      c.globalAlpha = 0.75;
      c.drawImage(this.bloomB, 0, 0, this.canvas.width, this.canvas.height);
    }

    // One flash, on the hundredth. Never more than one.
    const since = t - this.flashAt;
    if (since < 0.7) {
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = Math.pow(1 - since / 0.7, 2) * this.flashPower;
      c.fillStyle = "#FFF6E0";
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  }

  /** Light behind the number: building through the hold, a steady glow after. */
  private drawCore(s: CanvasRenderingContext2D): void {
    const t = this.t;
    let power = 0;
    if (this.phase === "hold") power = 0.45 * clamp01((t - HOLD_AT) / (BURST_AT - HOLD_AT));
    else if (this.phase === "burst" || this.phase === "crown") {
      const beat = Math.exp(-(t - this.beatAt) * 3);
      power = 0.16 + 0.5 * Math.exp(-(t - BURST_AT) * 2.5) + 0.1 * beat;
    }
    if (power <= 0.01) return;
    const r = this.R * (0.75 + 0.25 * power);
    const g = s.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, r);
    g.addColorStop(0, `rgba(255,244,214,${power})`);
    g.addColorStop(0.5, `rgba(${rgb(GOLD)},${power * 0.35})`);
    g.addColorStop(1, `rgba(${rgb(GOLD)},0)`);
    s.fillStyle = g;
    s.fillRect(this.cx - r, this.cy - r, r * 2, r * 2);
  }

  private drawDial(s: CanvasRenderingContext2D): void {
    const t = this.t;
    const { cx, cy } = this;
    const R = this.R * this.scale;
    const crowned = this.lit >= DIAL_DAYS;
    const hold = this.phase === "hold" ? clamp01((t - HOLD_AT) / (BURST_AT - HOLD_AT)) : 0;
    const w = Math.max(1.5, this.R * 0.02);
    const inner = R * 0.86;
    const step = (Math.PI * 2) / DIAL_DAYS;

    // The run so far, as an arc inside the ticks, in the colour of each tier.
    s.lineCap = "round";
    if (crowned) {
      s.globalAlpha = 0.4;
      s.strokeStyle = GOLD;
      s.lineWidth = w * 1.2;
      s.beginPath();
      s.arc(cx, cy, inner, 0, Math.PI * 2);
      s.stroke();
    } else if (this.lit > 0) {
      s.globalAlpha = 0.5 + 0.4 * hold;
      s.lineWidth = w * 1.4;
      let from = 1;
      for (let day = 1; day <= this.lit; day++) {
        if (day < this.lit && DAY_COLOR[day + 1] === DAY_COLOR[from]) continue;
        s.strokeStyle = DAY_COLOR[from];
        s.beginPath();
        s.arc(cx, cy, inner, angleOf(from) + this.spin, angleOf(day) + this.spin + step * 0.5);
        s.stroke();
        from = day + 1;
      }
    }

    // The ticks
    const appear = clamp01(t / 0.5);
    s.lineWidth = w;
    for (let day = 1; day <= DIAL_DAYS; day++) {
      const a = angleOf(day) + this.spin;
      const major = day % 10 === 0;
      const base = this.R * (major ? 0.12 : 0.07);
      let len = base;
      let color: string;
      let alpha: number;
      if (day > this.lit) {
        // Unlit, drawn in clockwise as the show opens.
        const shown = clamp01(appear * DIAL_DAYS - day + 1);
        if (shown <= 0) continue;
        color = "#FFFFFF";
        alpha = (major ? 0.16 : 0.1) * shown;
      } else if (crowned) {
        // The halo: gold, with a highlight running round it.
        const peak = Math.pow(Math.max(0, Math.cos(a - this.shimmer)), 18);
        const gild = clamp01((t - BURST_AT) / 0.6);
        color = peak > 0.55 ? "#FFFFFF" : major ? PALE_GOLD : GOLD;
        alpha = 0.6 + 0.4 * peak;
        len *= 1 + 0.4 * peak + 0.9 * (1 - gild) * (1 - gild);
      } else {
        const age = t - this.litAt[day];
        const pop = clamp01(1 - age / 0.22);
        len *= 1 + 0.9 * pop * pop;
        if (hold > 0) len *= 1 + Math.random() * 0.4 * hold; // straining
        color = age < 0.05 ? "#FFFFFF" : DAY_COLOR[day];
        alpha = 1;
      }
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const r0 = R - base / 2;
      s.globalAlpha = alpha;
      s.strokeStyle = color;
      s.beginPath();
      s.moveTo(cx + cos * r0, cy + sin * r0);
      s.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
      s.stroke();
    }

    // The comet head at the newest day
    if (!crowned && this.lit > 0) {
      const a = angleOf(this.lit) + this.spin;
      const size = this.R * (0.34 + 0.3 * hold) * (1 + 0.15 * Math.sin(t * 40) * hold);
      s.globalAlpha = 0.9;
      s.drawImage(glowSprite(DAY_COLOR[this.lit]), cx + Math.cos(a) * R - size / 2, cy + Math.sin(a) * R - size / 2, size, size);
    }
    s.globalAlpha = 1;
  }

  private drawSparks(s: CanvasRenderingContext2D): void {
    let current = -1;
    s.lineCap = "butt";
    for (let i = 0; i < this.sparkCount; i++) {
      const color = this.sColor[i];
      if (color !== current) {
        current = color;
        s.fillStyle = this.palette[color];
        s.strokeStyle = this.palette[color];
      }
      const f = this.sLife[i] / this.sMax[i];
      let alpha = f < 0.4 ? f / 0.4 : 1;
      if (this.sSoft[i]) alpha *= clamp01((this.sMax[i] - this.sLife[i]) / 0.6);
      s.globalAlpha = alpha;
      const size = this.sSize[i] * (f < 0.4 ? 0.5 + f * 1.25 : 1);
      // Fast sparks streak along their path; slow ones are motes.
      const dx = this.sVX[i] * 0.022;
      const dy = this.sVY[i] * 0.022;
      if (dx * dx + dy * dy > size * size * 4) {
        s.lineWidth = size;
        s.beginPath();
        s.moveTo(this.sX[i] - dx, this.sY[i] - dy);
        s.lineTo(this.sX[i], this.sY[i]);
        s.stroke();
      } else {
        s.fillRect(this.sX[i] - size / 2, this.sY[i] - size / 2, size, size);
      }
    }
    s.globalAlpha = 1;
  }

  private drawRings(s: CanvasRenderingContext2D): void {
    for (const r of this.rings) {
      const f = r.life / r.max;
      s.globalAlpha = f * r.alpha;
      s.strokeStyle = r.color;
      s.lineWidth = Math.max(0.5, r.width * f);
      s.beginPath();
      s.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      s.stroke();
    }
    s.globalAlpha = 1;
  }

  /** Four-point stars that wink in and out. */
  private drawGlints(s: CanvasRenderingContext2D): void {
    for (const g of this.glints) {
      const u = 1 - g.life / g.max;
      const k = Math.sin(Math.PI * u);
      const size = g.size * (0.4 + 0.6 * k);
      const thin = size * 0.16;
      s.save();
      s.translate(g.x, g.y);
      s.rotate(g.rot + u * 0.6);
      s.globalAlpha = k;
      s.fillStyle = g.color;
      s.beginPath();
      s.moveTo(0, -size);
      s.lineTo(thin, -thin);
      s.lineTo(size, 0);
      s.lineTo(thin, thin);
      s.lineTo(0, size);
      s.lineTo(-thin, thin);
      s.lineTo(-size, 0);
      s.lineTo(-thin, -thin);
      s.closePath();
      s.fill();
      const core = size * 1.1;
      s.drawImage(glowSprite(g.color), -core / 2, -core / 2, core, core);
      s.restore();
    }
    s.globalAlpha = 1;
  }

  private drawOrbiters(s: CanvasRenderingContext2D): void {
    if (this.phase !== "burst" && this.phase !== "crown") return;
    const fade = clamp01((this.t - BURST_AT - 0.3) / 0.8);
    if (fade <= 0) return;
    s.globalAlpha = fade;
    for (const o of ORBITERS) {
      const a = o.phase + this.t * o.speed;
      const x = this.cx + Math.cos(a) * this.R * o.r;
      const y = this.cy + Math.sin(a) * this.R * o.r;
      const size = 26 * o.size * Math.max(0.7, this.unit);
      s.drawImage(glowSprite(o.color), x - size / 2, y - size / 2, size, size);
    }
    s.globalAlpha = 1;
  }

  private drawRays(c: CanvasRenderingContext2D): void {
    const fade = clamp01((this.t - this.raysAt) / 1.2);
    if (fade <= 0) return;
    const { cx, cy } = this;
    const R = Math.hypot(this.W, this.H) * 0.8;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.translate(cx, cy);
    c.rotate(this.t * 0.06);
    c.globalAlpha = 0.3 * fade;
    c.drawImage(this.rays, -R, -R, 2 * R, 2 * R);
    c.rotate(-this.t * 0.14 + 0.4);
    c.globalAlpha = 0.15 * fade;
    c.drawImage(this.rays, -R * 0.7, -R * 0.7, 1.4 * R, 1.4 * R);
    c.restore();

    const hr = this.R * 2.6;
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, hr);
    g.addColorStop(0, `rgba(${rgb(GOLD)},${0.2 * fade})`);
    g.addColorStop(1, `rgba(${rgb(GOLD)},0)`);
    c.globalCompositeOperation = "lighter";
    c.fillStyle = g;
    c.fillRect(cx - hr, cy - hr, hr * 2, hr * 2);
    c.globalCompositeOperation = "source-over";
  }
}
