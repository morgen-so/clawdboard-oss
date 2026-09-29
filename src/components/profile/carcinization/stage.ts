// ─── Carcinization stage ────────────────────────────────────────────────────
// One canvas and one particle system, carried across the whole takeover. The
// run lights up a day at a time, implodes, and the same particles are what the
// big bang throws out, what CLAWD PRIME is assembled from, and what pours into
// the avatar at the coronation. The DOM layers (text, avatar, buttons) sit on
// top; this only paints light.
//
// Everything draws into an offscreen scene canvas (which keeps motion trails),
// then gets composited onto the visible canvas with a cheap two-level bloom:
// downsample, upscale, add. A frame-time governor drops the bloom, then the
// pixel ratio, if the machine can't keep up.

import { PASS_DAY } from "@/lib/carcinization-run";
import { CRAB_H, CRAB_PIXELS, CRAB_W } from "./crab";
import type { CarcSound } from "./sound";

export type Beat =
  | "anomaly"
  | "panic"
  | "boot"
  | "replay"
  | "bang"
  | "summon"
  | "ascend"
  | "crown";

// ─── Replay timeline ────────────────────────────────────────────────────────
// Shared with the component so its timers and CSS delays match the canvas.

export interface ReplayTimeline {
  /** Seconds from the start of the beat at which each day ignites. */
  ignite: number[];
  lastIgnite: number;
  implodeStart: number;
  implodeEnd: number;
  total: number;
}

/**
 * The first days tick like a slow heartbeat, then it accelerates until the
 * back half of the run pours in several days a frame.
 */
export function replayTimeline(days: number): ReplayTimeline {
  const ignite: number[] = [];
  const floor = Math.min(0.012, Math.max(0.004, 1.4 / Math.max(1, days)));
  let t = 0.8;
  for (let i = 0; i < days; i++) {
    ignite.push(t);
    t += Math.max(floor, 0.24 * Math.pow(0.93, i));
  }
  const lastIgnite = ignite[days - 1] ?? 0.8;
  const implodeStart = lastIgnite + 0.55; // hit-stop on the final day
  const implodeEnd = implodeStart + 0.8;
  return {
    ignite,
    lastIgnite,
    implodeStart,
    implodeEnd,
    total: implodeEnd + 0.4,
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Vertical centre of the crab (and of the big bang), as a share of height. */
export const CRAB_Y = 0.4;

// Crab particle modes
const OFF = 0;
const BURST = 1;
const SEEK = 2;
const HELD = 3;
const ABSORB = 4;
const GONE = 5;

const PART_CLAW = 0;
const PART_SHELL = 1;
const PART_EYE = 2;
const PART_LEG = 3;
const PART_CODE = { claw: PART_CLAW, shell: PART_SHELL, eye: PART_EYE, leg: PART_LEG };

/** Flying particles glow hot, cooling to their crab colour as they slow. */
const HEAT = ["#FFFFFF", "#FFEBC2", "#FBC15B"];

const SPARK_COLORS = [
  "#FFFFFF", // 0
  "#FFE9B0", // 1
  "#FBC15B", // 2
  "#F9A615", // 3
  "#F7901A", // 4
  "#f43f5e", // 5
  "#a855f7", // 6
  "#22d3ee", // 7
  "#facc15", // 8
  "#7dd3fc", // 9  free-pass ice
];
const FIREWORK_HUES = [2, 5, 6, 7, 8, 3];

const PASS_COLOR = "#7dd3fc";

/** Vertical centre of the eyes in crab units, for blinking (squinting, really). */
const EYE_CY = (() => {
  const rows = CRAB_PIXELS.filter((p) => p.ch === "E").map((p) => p.row);
  return (Math.min(...rows) + Math.max(...rows) + 1) / 2 - CRAB_H / 2;
})();
/** Where each claw's arm meets the shell, in crab units (mirrored per side). */
const SHOULDER_X = 10;
const SHOULDER_Y = 0.5;
const MAX_SPARKS = 3200;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Day intensity (0-1) to a colour: ember brown through gold to white-hot. */
const CELL_RAMP = (() => {
  const stops: [number, [number, number, number]][] = [
    [0, [120, 45, 18]],
    [0.35, [194, 65, 12]],
    [0.7, [249, 166, 21]],
    [1, [255, 233, 176]],
  ];
  return Array.from({ length: 24 }, (_, i) => {
    const t = i / 23;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k];
    const [t1, c1] = stops[k + 1];
    const u = (t - t0) / (t1 - t0);
    const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * u));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  });
})();

/** Pre-rendered light beams, drawn rotated under the crab or the avatar. */
function buildRays(canvas: HTMLCanvasElement, core: string, edge: string): void {
  const S = 512;
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext("2d")!;
  const c = S / 2;
  const beams = 20;
  for (let k = 0; k < beams; k++) {
    const a = (k / beams) * Math.PI * 2;
    const w = k % 2 === 0 ? 0.13 : 0.045;
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c, a - w / 2, a + w / 2);
    g.closePath();
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, `rgba(${core},0.45)`);
    grad.addColorStop(0.25, `rgba(${edge},0.14)`);
    grad.addColorStop(1, `rgba(${edge},0)`);
    g.fillStyle = grad;
    g.fill();
  }
}

interface Cell {
  x: number;
  y: number;
  col: number;
  level: number;
  pass: boolean;
  spin: number;
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
}

interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Per-rocket gravity, so it peaks exactly as the fuse runs out. */
  g: number;
  fuse: number;
  kind: "peony" | "ring" | "willow" | "crab";
  hue: number;
}

interface Star {
  x: number;
  y: number;
  z: number;
  tw: number;
}

export interface StageOptions {
  /** One entry per calendar day of the run (see CarcinizationRun.days). */
  days: number[];
  /** Weekday of the run's first day, Monday = 0. */
  startWeekday: number;
  sound: CarcSound;
  /** Element shaken along with the canvas (the DOM layers). */
  shakeEl: HTMLElement | null;
  /** Fires at most once a frame while the run replays. */
  onDay?: (activeDays: number, dayIndex: number) => void;
}

// ─── Stage ──────────────────────────────────────────────────────────────────

export class CarcStage {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scene = document.createElement("canvas");
  private readonly sctx: CanvasRenderingContext2D;
  private readonly bloomA = document.createElement("canvas");
  private readonly bloomB = document.createElement("canvas");
  private readonly actx: CanvasRenderingContext2D;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly goldRays = document.createElement("canvas");
  private readonly bloodRays = document.createElement("canvas");
  private readonly opts: StageOptions;

  private W = 0;
  private H = 0;
  private dpr = 1;
  private quality = 2; // 2 = bloom, 1 = no bloom, 0 = no bloom at 1x
  private slowFrames = 0;
  private raf = 0;
  private last = 0;
  /** Stage time in seconds: frames rendered, not wall clock. */
  private t = 0;
  private beat: Beat = "anomaly";
  private beatAt = 0;
  private destroyed = false;

  private shakeAmp = 0;
  private flashAt = -99;
  private flashPower = 0;

  // Replay
  private readonly tl: ReplayTimeline;
  private cells: Cell[] = [];
  private cellSize = 10;
  private lit = 0;
  private active = 0;
  private riserStop: (() => void) | null = null;
  private finalHit = false;
  private cutDone = false;

  // Stars
  private stars: Star[] = [];
  private warp = 0.012;

  // Crab
  private readonly N = CRAB_PIXELS.length * 4;
  private readonly px = new Float32Array(this.N);
  private readonly py = new Float32Array(this.N);
  private readonly vx = new Float32Array(this.N);
  private readonly vy = new Float32Array(this.N);
  private readonly lx = new Float32Array(this.N);
  private readonly ly = new Float32Array(this.N);
  private readonly row = new Uint8Array(this.N);
  private readonly lid = new Uint8Array(this.N);
  /** One particle per molten crack or maw pixel: where the embers leak out. */
  private readonly vents: number[] = [];
  private readonly part = new Uint8Array(this.N);
  private readonly side = new Int8Array(this.N);
  private readonly mode = new Uint8Array(this.N);
  private readonly seekAt = new Float32Array(this.N);
  private readonly absorbAt = new Float32Array(this.N);
  private readonly absorbDur = new Float32Array(this.N);
  private readonly sx = new Float32Array(this.N);
  private readonly sy = new Float32Array(this.N);
  private readonly cx = new Float32Array(this.N);
  private readonly cy = new Float32Array(this.N);
  private readonly colorGroups: { color: string; idx: Uint16Array }[];
  private crabSpawned = false;
  private absorbed = 0;
  private crabX = 0;
  private crabY = 0;
  private crabScale = 10;
  private pulseAt = -99;
  private raysAt = -99;
  // Pose, recomputed each frame
  private clawL = 0;
  private clawR = 0;
  private bob = 0;
  private blink = 0;
  private pscale = 1;
  private rageX = 0;
  private rageY = 0;
  private emberDebtCrab = 0;

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

  private rings: Ring[] = [];
  private rockets: Rocket[] = [];
  private nextFirework = 0;
  private fireworkIndex = 0;
  private emberDebt = 0;

  // Coronation anchor (avatar centre, CSS px)
  private ax = 0;
  private ay = 0;
  private anchored = false;

  constructor(canvas: HTMLCanvasElement, opts: StageOptions) {
    this.canvas = canvas;
    this.opts = opts;
    this.ctx = canvas.getContext("2d")!;
    this.sctx = this.scene.getContext("2d")!;
    this.actx = this.bloomA.getContext("2d")!;
    this.bctx = this.bloomB.getContext("2d")!;
    this.tl = replayTimeline(opts.days.length);

    // Crab particles: each sprite pixel splits into a 2×2 of particles.
    const groups = new Map<string, number[]>();
    let i = 0;
    for (const p of CRAB_PIXELS) {
      for (const [ox, oy] of [
        [-0.25, -0.25],
        [0.25, -0.25],
        [-0.25, 0.25],
        [0.25, 0.25],
      ]) {
        this.lx[i] = p.col + 0.5 + ox - CRAB_W / 2;
        this.ly[i] = p.row + 0.5 + oy - CRAB_H / 2;
        this.row[i] = p.row;
        this.lid[i] = p.ch === "E" ? 1 : 0;
        if (ox < 0 && oy < 0 && (p.ch === "X" || p.ch === "F")) this.vents.push(i);
        this.part[i] = PART_CODE[p.part];
        this.side[i] = p.side;
        const list = groups.get(p.color) ?? [];
        list.push(i);
        groups.set(p.color, list);
        i++;
      }
    }
    this.colorGroups = [...groups].map(([color, idx]) => ({
      color,
      idx: Uint16Array.from(idx),
    }));

    this.resize();
    this.stars = Array.from({ length: 260 }, () => this.newStar(rand(0.05, 1)));
    buildRays(this.goldRays, "255,236,190", "249,166,21");
    buildRays(this.bloodRays, "255,120,80", "200,24,24");
    window.addEventListener("resize", this.resize);
  }

  start(): void {
    this.last = performance.now();
    this.t = 0;
    this.beatAt = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.riserStop?.();
    if (this.opts.shakeEl) this.opts.shakeEl.style.transform = "";
  }

  // ── Public controls ──

  setBeat(beat: Beat): void {
    const prev = this.beat;
    this.beat = beat;
    this.beatAt = this.t;
    const { sound } = this.opts;

    if (prev === "replay" && beat !== "replay") {
      this.riserStop?.();
      this.riserStop = null;
    }

    switch (beat) {
      case "replay":
        this.lit = 0;
        this.active = 0;
        this.finalHit = false;
        this.cutDone = false;
        break;
      case "bang":
        this.bigBang();
        break;
      case "summon":
        if (!this.crabSpawned) this.gatherFromNowhere();
        this.raysAt = this.t;
        break;
      case "ascend":
        this.startAbsorb();
        sound.absorb(1.5);
        break;
      case "crown":
        this.coronation();
        break;
    }
  }

  /** CLAWD PRIME speaks: swell, glow, raise the claws. */
  pulse(): void {
    this.pulseAt = this.t;
    this.shake(3);
  }

  setAnchor(x: number, y: number): void {
    this.ax = x;
    this.ay = y;
    this.anchored = true;
  }

  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  // ── Setup ──

  private resize = (): void => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.W = W;
    this.H = H;
    this.dpr = this.quality > 0 ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const w = Math.round(W * this.dpr);
    const h = Math.round(H * this.dpr);
    for (const c of [this.canvas, this.scene]) {
      c.width = w;
      c.height = h;
    }
    this.bloomA.width = Math.max(1, Math.round(w / 4));
    this.bloomA.height = Math.max(1, Math.round(h / 4));
    this.bloomB.width = Math.max(1, Math.round(w / 16));
    this.bloomB.height = Math.max(1, Math.round(h / 16));
    this.sctx.fillStyle = "#000";
    this.sctx.fillRect(0, 0, w, h);

    this.crabScale = Math.min((W * 0.8) / CRAB_W, (H * 0.38) / CRAB_H, 15);
    this.crabX = W / 2;
    this.crabY = H * CRAB_Y;
    this.layoutGrid();
  };

  private layoutGrid(): void {
    const n = this.opts.days.length;
    const w0 = this.opts.startWeekday;
    const cols = Math.max(1, Math.ceil((w0 + n) / 7));
    const step = Math.min(28, (this.W * 0.9) / cols, (this.H * 0.34) / 7);
    this.cellSize = step * 0.8;
    const ox = (this.W - cols * step) / 2 + step / 2;
    const oy = this.H * 0.64 - (7 * step) / 2 + step / 2;
    const prev = this.cells;
    this.cells = this.opts.days.map((level, k) => {
      const slot = w0 + k;
      const col = Math.floor(slot / 7);
      return {
        x: ox + col * step,
        y: oy + (slot % 7) * step,
        col,
        level: Math.max(0, level),
        pass: level === PASS_DAY,
        spin: prev[k]?.spin ?? rand(0, 1.2),
      };
    });
  }

  private newStar(z = 1): Star {
    return { x: rand(-1, 1), y: rand(-1, 1), z, tw: rand(0, Math.PI * 2) };
  }

  // ── Frame ──

  private frame = (now: number): void => {
    if (this.destroyed) return;
    // The stage keeps its own clock, advanced only by frames it renders. A long
    // gap means the tab was hidden: carry on from where it stopped rather than
    // jumping ahead (the component's timers pause alongside it).
    const gap = (now - this.last) / 1000;
    const dt = gap > 0.25 ? 1 / 60 : Math.min(0.1, Math.max(0.0001, gap));
    this.last = now;
    this.t += dt;
    this.govern(dt);

    const tb = this.t - this.beatAt;
    this.updateShake(dt);

    const painting = this.beat !== "anomaly" && this.beat !== "panic" && this.beat !== "boot";
    if (painting) {
      this.update(dt, tb);
      this.draw(tb);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Drop bloom, then resolution, if frames keep running long. */
  private govern(dt: number): void {
    if (this.quality === 0) return;
    const painting = this.beat !== "anomaly" && this.beat !== "panic" && this.beat !== "boot";
    if (!painting) return;
    this.slowFrames = dt > 1 / 38 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 50) {
      this.quality -= 1;
      this.slowFrames = 0;
      if (this.quality === 0) this.resize();
    }
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

  private update(dt: number, tb: number): void {
    if (this.beat === "replay") this.updateReplay(tb);

    // Stars: the warp spikes for the bang, then settles into a slow drift.
    let target = 0.012;
    if (this.beat === "bang") {
      const up = clamp01((tb - 0.25) / 0.5);
      const down = clamp01((tb - 1.5) / 1.3);
      target = 0.012 + 2.1 * up * (1 - down);
    }
    this.warp += (target - this.warp) * Math.min(1, dt * 6);
    for (const s of this.stars) {
      s.z -= this.warp * dt;
      if (s.z < 0.04) Object.assign(s, this.newStar(1));
    }

    this.updatePose();
    this.updateCrab(dt);
    if (this.beat === "summon") this.smoulder(dt);
    this.updateSparks(dt);
    this.updateRings(dt);
    if (this.beat === "crown") this.updateCrown(dt, tb);
  }

  // ── Replay ──

  private updateReplay(tb: number): void {
    const { ignite, lastIgnite, implodeStart, implodeEnd } = this.tl;
    const n = this.cells.length;
    const { sound, onDay } = this.opts;
    let changed = false;

    while (this.lit < n && tb >= ignite[this.lit]) {
      const k = this.lit++;
      const c = this.cells[k];
      if (!c.pass) this.active++;
      changed = true;
      sound.tick(k / Math.max(1, n - 1));
      const fast = k > 60;
      for (let s = 0; s < (fast ? 1 : 3); s++) {
        this.spawnSpark(c.x, c.y, rand(-60, 60), rand(-220, -60), rand(0.35, 0.7), rand(1.2, 2.4), 2.5, 260, c.pass ? 9 : 2);
      }
      if (k === 25) this.riserStop = sound.riser(Math.max(0.5, implodeEnd - tb));
    }
    if (changed) onDay?.(this.active, this.lit - 1);

    if (!this.finalHit && tb >= lastIgnite && this.lit >= n) {
      this.finalHit = true;
      const c = this.cells[n - 1];
      if (c) {
        this.addRing(c.x, c.y, 900, 3, 0.7, "#FFFFFF");
        for (let s = 0; s < 40; s++) {
          const a = rand(0, Math.PI * 2);
          const v = rand(120, 520);
          this.spawnSpark(c.x, c.y, Math.cos(a) * v, Math.sin(a) * v, rand(0.4, 0.9), rand(1.4, 2.6), 3, 80, 1);
        }
      }
      this.shake(7);
    }

    if (!this.cutDone && tb >= implodeEnd) {
      // The silence before the bang.
      this.cutDone = true;
      this.riserStop?.();
      this.riserStop = null;
    }
    if (tb >= implodeStart && tb < implodeEnd) this.shake(1.5 + 5 * ((tb - implodeStart) / 0.8));
  }

  // ── The big bang ──

  private bigBang(): void {
    const { sound } = this.opts;
    const x = this.crabX;
    const y = this.crabY;
    sound.impact();
    sound.warp(2.6);
    this.flashAt = this.t;
    this.flashPower = 1;
    this.shake(18);
    this.addRing(x, y, 2200, 12, 1.1, "#FFFFFF");
    this.addRing(x, y, 1100, 28, 1.4, "#F9A615");
    this.addRing(x, y, 600, 6, 1.6, "#f43f5e");

    for (let i = 0; i < this.N; i++) {
      const a = rand(0, Math.PI * 2);
      const v = 200 + 1500 * Math.pow(Math.random(), 1.8);
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = Math.cos(a) * v;
      this.vy[i] = Math.sin(a) * v;
      this.mode[i] = BURST;
      // The outer shell of the crab gathers first, the heart last.
      const dist = Math.hypot(this.lx[i], this.ly[i]) / 22;
      this.seekAt[i] = this.t + 0.8 + (1 - dist) * 0.5 + Math.random() * 0.55;
    }
    this.crabSpawned = true;

    for (let s = 0; s < 420; s++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(300, 2000);
      this.spawnSpark(x, y, Math.cos(a) * v, Math.sin(a) * v, rand(0.5, 1.5), rand(1.2, 3), 2.2, 0, FIREWORK_HUES[s % FIREWORK_HUES.length]);
    }
  }

  /** Entering CLAWD PRIME without the bang first (a skip or a preview). */
  private gatherFromNowhere(): void {
    for (let i = 0; i < this.N; i++) {
      this.px[i] = rand(0, this.W);
      this.py[i] = rand(0, this.H);
      this.vx[i] = 0;
      this.vy[i] = 0;
      this.mode[i] = SEEK;
      this.seekAt[i] = this.t + Math.random() * 0.4;
    }
    this.crabSpawned = true;
  }

  // ── Crab ──

  private updatePose(): void {
    const t = this.t;
    const since = t - this.pulseAt;
    const pulse = since >= 0 ? Math.exp(-since * 3) : 0;
    // Two quick snaps every couple of seconds; claws thrown up when it speaks.
    const snapPhase = (t * 0.45) % 1;
    const snap =
      snapPhase < 0.07
        ? Math.sin((snapPhase / 0.07) * Math.PI)
        : snapPhase > 0.1 && snapPhase < 0.17
          ? Math.sin(((snapPhase - 0.1) / 0.07) * Math.PI)
          : 0;
    const wave = Math.sin(t * 1.25) * 0.08 + snap * 0.26 + pulse * 0.4;
    this.clawL = wave;
    this.clawR = -wave;
    this.bob = Math.sin(t * 1.5) * 0.35;
    // Blinks become a slow, contemptuous squint.
    const bp = t % 4.2;
    this.blink = bp < 0.5 ? Math.sin((bp / 0.5) * Math.PI) * 0.7 : 0;
    this.pscale = 1 + 0.06 * pulse + 0.012 * Math.sin(t * 1.5 + 1);
    // It trembles with rage while it talks.
    const rage = 0.12 + 0.5 * pulse;
    this.rageX = (Math.random() * 2 - 1) * rage;
    this.rageY = (Math.random() * 2 - 1) * rage * 0.6;
  }

  /** Where particle i belongs right now, given the pose. */
  private target(i: number, out: [number, number]): void {
    let x = this.lx[i];
    let y = this.ly[i];
    const part = this.part[i];
    if (part === PART_CLAW) {
      // Claws swing about the shoulder where the arm meets the shell.
      const side = this.side[i];
      const a = side < 0 ? this.clawL : this.clawR;
      const pxv = side * SHOULDER_X;
      const pyv = SHOULDER_Y;
      const dx = x - pxv;
      const dy = y - pyv;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      x = pxv + dx * cos - dy * sin;
      y = pyv + dx * sin + dy * cos;
    } else if (part === PART_LEG) {
      y += Math.sin(this.t * 5 + this.row[i] * 1.1 + this.side[i]) * 0.14;
    } else if (this.lid[i] && this.blink > 0) {
      y = EYE_CY + (y - EYE_CY) * (1 - this.blink);
    }
    const s = this.crabScale * this.pscale;
    out[0] = this.crabX + (x + this.rageX) * s;
    out[1] = this.crabY + (y + this.bob + this.rageY) * s;
  }

  private updateCrab(dt: number): void {
    if (!this.crabSpawned) return;
    const t = this.t;
    const tgt: [number, number] = [0, 0];
    const drag = Math.exp(-2.4 * dt);
    const w = 7.5;
    const k = w * w;
    const c = 2 * 0.78 * w;

    for (let i = 0; i < this.N; i++) {
      const m = this.mode[i];
      if (m === OFF || m === GONE) continue;

      if (m === BURST) {
        this.vx[i] *= drag;
        this.vy[i] *= drag;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        if (t >= this.seekAt[i]) this.mode[i] = SEEK;
        continue;
      }

      if (m === ABSORB && t >= this.absorbAt[i]) {
        const u = (t - this.absorbAt[i]) / this.absorbDur[i];
        if (u >= 1) {
          this.mode[i] = GONE;
          this.absorbed++;
          continue;
        }
        const e = u * u;
        const inv = 1 - e;
        this.px[i] = inv * inv * this.sx[i] + 2 * inv * e * this.cx[i] + e * e * this.ax;
        this.py[i] = inv * inv * this.sy[i] + 2 * inv * e * this.cy[i] + e * e * this.ay;
        continue;
      }

      this.target(i, tgt);
      const dx = tgt[0] - this.px[i];
      const dy = tgt[1] - this.py[i];

      if (m === SEEK) {
        if (t < this.seekAt[i]) continue;
        // Critically-ish damped spring, plus a swirl that fades as they arrive.
        const swirl = 1.4 * Math.exp(-(t - this.seekAt[i]) * 2.4);
        const ax = k * dx - c * this.vx[i] - swirl * k * dy * 0.6;
        const ay = k * dy - c * this.vy[i] + swirl * k * dx * 0.6;
        this.vx[i] += ax * dt;
        this.vy[i] += ay * dt;
        this.px[i] += this.vx[i] * dt;
        this.py[i] += this.vy[i] * dt;
        if (dx * dx + dy * dy < 2 && this.vx[i] ** 2 + this.vy[i] ** 2 < 900) {
          this.mode[i] = HELD;
        }
        continue;
      }

      // HELD, or ABSORB still waiting its turn: ride the pose.
      this.px[i] = tgt[0];
      this.py[i] = tgt[1];
    }
  }

  /** Embers leaking from the molten cracks and the furnace maw. */
  private smoulder(dt: number): void {
    const since = this.t - this.pulseAt;
    const rate = 16 + (since >= 0 ? 60 * Math.exp(-since * 2) : 0);
    this.emberDebtCrab += dt * rate;
    while (this.emberDebtCrab >= 1) {
      this.emberDebtCrab -= 1;
      const i = this.vents[Math.floor(Math.random() * this.vents.length)];
      if (i === undefined || this.mode[i] !== HELD) continue;
      this.spawnSparkColor(
        this.px[i] + rand(-3, 3),
        this.py[i],
        rand(-18, 18),
        rand(-90, -30),
        rand(0.9, 2),
        rand(1.4, 3),
        0.6,
        -25,
        Math.random() < 0.6 ? "#FF7A1A" : "#FFB23F"
      );
    }
  }

  private startAbsorb(): void {
    if (!this.crabSpawned) return;
    if (!this.anchored) this.setAnchor(this.W / 2, this.H * 0.3);
    for (let i = 0; i < this.N; i++) {
      if (this.mode[i] === GONE || this.mode[i] === OFF) continue;
      // Legs lift off first, the eyes last: the crab rises into the avatar.
      const fromBottom = 1 - this.row[i] / (CRAB_H - 1);
      this.absorbAt[i] = this.t + 0.15 + fromBottom * 0.75 + Math.random() * 0.25;
      this.absorbDur[i] = rand(0.5, 0.8);
      this.mode[i] = ABSORB;
    }
    this.absorbed = 0;
  }

  // ── Coronation ──

  private coronation(): void {
    const { sound } = this.opts;
    if (!this.anchored) this.setAnchor(this.W / 2, this.H * 0.3);
    for (let i = 0; i < this.N; i++) {
      if (this.mode[i] !== OFF) this.mode[i] = GONE;
    }
    this.crabSpawned = false;
    this.raysAt = this.t;
    sound.fanfare();
    this.flashAt = this.t;
    this.flashPower = 0.55;
    this.shake(10);
    this.addRing(this.ax, this.ay, 1500, 8, 1.2, "#FFFFFF");
    this.addRing(this.ax, this.ay, 800, 20, 1.5, "#FBC15B");
    for (let s = 0; s < 260; s++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(150, 900);
      this.spawnSpark(this.ax, this.ay, Math.cos(a) * v, Math.sin(a) * v, rand(0.7, 1.6), rand(1.4, 3), 2.4, 90, FIREWORK_HUES[s % FIREWORK_HUES.length]);
    }
    this.nextFirework = this.t + 0.5;
    this.fireworkIndex = 0;
  }

  private updateCrown(dt: number, tb: number): void {
    // An opening barrage, then a firework every few seconds for a while.
    if (this.t >= this.nextFirework && tb < 45) {
      this.launch();
      this.fireworkIndex++;
      const gap =
        this.fireworkIndex < 14 ? rand(0.35, 0.75) : rand(2.2, 4.2);
      this.nextFirework = this.t + gap;
    }

    for (let r = this.rockets.length - 1; r >= 0; r--) {
      const k = this.rockets[r];
      k.vy += k.g * dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      this.spawnSpark(k.x, k.y, rand(-20, 20), rand(20, 60), rand(0.2, 0.45), rand(1, 1.8), 3, 60, 1);
      if (this.t >= k.fuse) {
        this.explode(k);
        this.rockets.splice(r, 1);
      }
    }

    // Embers drifting up from the bottom edge.
    this.emberDebt += dt * (this.quality > 1 ? 16 : 8);
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      this.spawnSpark(rand(0, this.W), this.H + 8, rand(-12, 12), rand(-90, -30), rand(4, 8), rand(1, 2.4), 0, -3, Math.random() < 0.7 ? 2 : 5);
    }
  }

  private launch(): void {
    const kinds: Rocket["kind"][] = ["peony", "crab", "ring", "peony", "willow", "crab", "peony", "ring"];
    const kind = kinds[this.fireworkIndex % kinds.length];
    // Keep to the flanks, where they won't sit behind the title.
    const left = this.fireworkIndex % 2 === 0;
    const x = this.W * (left ? rand(0.08, 0.34) : rand(0.66, 0.92));
    // On a phone the flanks are narrow, so keep the bursts up in the sky.
    const apex = this.H * rand(this.W < 640 ? 0.08 : 0.14, this.W < 640 ? 0.26 : 0.42);
    const flight = rand(0.9, 1.2);
    const rise = this.H + 10 - apex;
    this.rockets.push({
      x,
      y: this.H + 10,
      vx: rand(-30, 30),
      vy: (-2 * rise) / flight,
      g: (2 * rise) / (flight * flight),
      fuse: this.t + flight,
      kind,
      hue: FIREWORK_HUES[this.fireworkIndex % FIREWORK_HUES.length],
    });
  }

  private explode(k: Rocket): void {
    const { x, y } = k;
    this.opts.sound.pop((x / this.W) * 2 - 1);
    this.spawnSpark(x, y, 0, 0, 0.18, 26, 0, 0, 0); // the flash
    const lite = this.quality < 2;

    if (k.kind === "crab") {
      // A firework that blooms into CLAWD PRIME's silhouette.
      const spread = (Math.min(this.W, this.H) * 0.16) / 20;
      const drag = 3.2;
      for (const p of CRAB_PIXELS) {
        if (lite && (p.col + p.row) % 2) continue;
        const lx = p.col + 0.5 - CRAB_W / 2;
        const ly = p.row + 0.5 - CRAB_H / 2;
        this.spawnSparkColor(x, y, lx * spread * drag, ly * spread * drag, rand(1.8, 2.3), 2.4, drag, 16, p.color);
      }
      return;
    }

    const count = (k.kind === "willow" ? 90 : k.kind === "ring" ? 80 : 130) * (lite ? 0.5 : 1);
    for (let s = 0; s < count; s++) {
      const a = (s / count) * Math.PI * 2 + rand(-0.05, 0.05);
      let v: number;
      if (k.kind === "ring") v = 280;
      else if (k.kind === "willow") v = rand(60, 220);
      else v = 300 * Math.sqrt(Math.random());
      const hue = k.kind === "willow" ? 8 : s % 5 === 0 ? 0 : k.hue;
      this.spawnSpark(
        x,
        y,
        Math.cos(a) * v,
        Math.sin(a) * v,
        k.kind === "willow" ? rand(2, 2.8) : rand(1.1, 1.7),
        k.kind === "willow" ? 1.6 : 2.2,
        k.kind === "willow" ? 1 : 1.8,
        k.kind === "willow" ? 45 : 70,
        hue
      );
    }
  }

  // ── Sparks & rings ──

  private sparkColors: string[] = [...SPARK_COLORS];

  private spawnSparkColor(x: number, y: number, vx: number, vy: number, life: number, size: number, drag: number, grav: number, color: string): void {
    let idx = this.sparkColors.indexOf(color);
    if (idx < 0) idx = this.sparkColors.push(color) - 1;
    this.spawnSpark(x, y, vx, vy, life, size, drag, grav, idx);
  }

  private spawnSpark(x: number, y: number, vx: number, vy: number, life: number, size: number, drag: number, grav: number, color: number): void {
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
    this.sColor[i] = color;
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

  private addRing(x: number, y: number, v: number, width: number, life: number, color: string): void {
    this.rings.push({ x, y, r: 4, v, width, life, max: life, color });
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

  // ── Draw ──

  private draw(tb: number): void {
    const s = this.sctx;
    const d = this.dpr;
    s.setTransform(d, 0, 0, d, 0, 0);
    s.globalCompositeOperation = "source-over";
    s.globalAlpha = 1;

    // Trails while things are fast, a clean slate otherwise.
    const imploding = this.beat === "replay" && tb >= this.tl.implodeStart;
    const trails = imploding || this.beat === "bang" || this.beat === "ascend" || this.beat === "crown";
    s.fillStyle = trails ? "rgba(0,0,0,0.3)" : "#000";
    s.fillRect(0, 0, this.W, this.H);

    if (this.beat === "replay") this.drawReplay(s, tb);
    this.drawCrab(s);
    this.drawSparks(s);
    this.drawRings(s);

    // The backdrop (stars, rays, halo) goes straight onto the visible canvas:
    // in the trail buffer it would pile up frame on frame to 3x brightness.
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = "#000";
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(d, 0, 0, d, 0, 0);
    this.drawStars(c);
    if (this.beat === "summon" || this.beat === "ascend" || this.beat === "crown") this.drawRays(c);
    if (this.beat === "ascend") this.drawAnchorGlow(c);

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
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = 0.4;
      c.drawImage(this.bloomA, 0, 0, this.canvas.width, this.canvas.height);
      c.globalAlpha = 0.7;
      c.drawImage(this.bloomB, 0, 0, this.canvas.width, this.canvas.height);
    }

    const since = this.t - this.flashAt;
    if (since < 0.7) {
      const a = Math.pow(1 - since / 0.7, 2) * this.flashPower;
      c.globalCompositeOperation = "source-over";
      c.globalAlpha = a;
      c.fillStyle = "#FFF6E0";
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";
  }

  private drawStars(s: CanvasRenderingContext2D): void {
    const f = Math.max(this.W, this.H) * 0.5;
    const cx = this.W / 2;
    const cy = this.H * CRAB_Y;
    const streak = this.warp > 0.15;
    s.fillStyle = "#FFFFFF";
    s.strokeStyle = "#FFF1D6";
    for (const st of this.stars) {
      const x = cx + (st.x / st.z) * f;
      const y = cy + (st.y / st.z) * f;
      if (x < -50 || x > this.W + 50 || y < -50 || y > this.H + 50) {
        Object.assign(st, this.newStar(1));
        continue;
      }
      const b = 1 - st.z;
      if (streak) {
        const pz = Math.min(1, st.z + this.warp * 0.06);
        s.globalAlpha = Math.min(1, b * 1.3);
        s.lineWidth = 0.6 + b * 1.8;
        s.beginPath();
        s.moveTo(cx + (st.x / pz) * f, cy + (st.y / pz) * f);
        s.lineTo(x, y);
        s.stroke();
      } else {
        s.globalAlpha = (0.25 + 0.75 * b) * (0.6 + 0.4 * Math.sin(this.t * 2 + st.tw));
        const size = 0.6 + b * 1.6;
        s.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
    s.globalAlpha = 1;
  }

  private drawRays(s: CanvasRenderingContext2D): void {
    const fade = clamp01((this.t - this.raysAt) / 2);
    if (fade <= 0) return;
    const onAvatar = this.beat === "crown";
    const x = onAvatar ? this.ax : this.crabX;
    const y = onAvatar ? this.ay : this.crabY;
    const R = Math.hypot(this.W, this.H) * (onAvatar ? 0.9 : 0.75);
    s.save();
    s.globalCompositeOperation = "lighter";
    s.translate(x, y);
    s.globalAlpha = (onAvatar ? 0.3 : 0.38) * fade;
    s.rotate(this.t * 0.05);
    const rays = onAvatar ? this.goldRays : this.bloodRays;
    s.drawImage(rays, -R, -R, 2 * R, 2 * R);
    s.rotate(-this.t * 0.12 + 0.4);
    s.globalAlpha = (onAvatar ? 0.16 : 0.2) * fade;
    s.drawImage(rays, -R * 0.7, -R * 0.7, 1.4 * R, 1.4 * R);
    s.restore();

    // Halo
    const hr = onAvatar ? 170 : this.crabScale * 22;
    const g = s.createRadialGradient(x, y, 0, x, y, hr);
    const tint = onAvatar ? "251,193,91" : "220,38,38";
    g.addColorStop(0, `rgba(${tint},${(onAvatar ? 0.22 : 0.3) * fade})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    s.globalCompositeOperation = "lighter";
    s.fillStyle = g;
    s.fillRect(x - hr, y - hr, hr * 2, hr * 2);
    s.globalCompositeOperation = "source-over";
  }

  private drawReplay(s: CanvasRenderingContext2D, tb: number): void {
    const { ignite, implodeStart, implodeEnd } = this.tl;
    const n = this.cells.length;
    const sxp = this.crabX;
    const syp = this.crabY;
    const u = clamp01((tb - implodeStart) / (implodeEnd - implodeStart));
    const e = u * u * u;
    const base = this.cellSize;

    for (let k = 0; k < n; k++) {
      const c = this.cells[k];
      const appear = clamp01((tb - c.col * 0.014) / 0.35);
      if (appear <= 0 || e >= 1) continue;
      let x = c.x;
      let y = c.y;
      let size = base;
      if (e > 0) {
        // Spiral into the singularity.
        const ang = e * (2 + c.spin);
        const dx = c.x - sxp;
        const dy = c.y - syp;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        x = sxp + (dx * cos - dy * sin) * (1 - e);
        y = syp + (dx * sin + dy * cos) * (1 - e);
        size = base * (1 - 0.75 * e);
      }

      if (k >= this.lit) {
        s.globalAlpha = appear * (1 - e) * 0.9;
        s.fillStyle = "#1b1b22";
        s.fillRect(x - size / 2, y - size / 2, size, size);
        continue;
      }

      const age = tb - ignite[k];
      const last = k === n - 1;
      const pop = clamp01(1 - age / (last ? 0.5 : 0.28));
      const ss = size * (1 + (last ? 1.4 : 0.9) * pop * pop);
      s.globalAlpha = 1;
      if (c.pass) {
        s.strokeStyle = PASS_COLOR;
        s.lineWidth = Math.max(1, size * 0.14);
        s.strokeRect(x - ss / 2, y - ss / 2, ss, ss);
        s.fillStyle = "rgba(125,211,252,0.18)";
      } else {
        s.fillStyle =
          age < (last ? 0.3 : 0.07)
            ? "#FFFFFF"
            : CELL_RAMP[Math.round(c.level * (CELL_RAMP.length - 1))];
      }
      s.fillRect(x - ss / 2, y - ss / 2, ss, ss);
    }
    s.globalAlpha = 1;

    // The singularity, swelling in the silence before the bang.
    if (tb >= implodeEnd - 0.15) {
      const v = clamp01((tb - implodeEnd + 0.15) / 0.5);
      const r = 6 + 60 * v * v + Math.random() * 4;
      const g = s.createRadialGradient(sxp, syp, 0, sxp, syp, r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,236,190,0.9)");
      g.addColorStop(1, "rgba(249,166,21,0)");
      s.globalCompositeOperation = "lighter";
      s.fillStyle = g;
      s.fillRect(sxp - r, syp - r, r * 2, r * 2);
      s.globalCompositeOperation = "source-over";
    }
  }

  private drawCrab(s: CanvasRenderingContext2D): void {
    if (!this.crabSpawned) return;
    const t = this.t;
    const unit = this.crabScale * this.pscale;
    const held = unit * 0.5 * 0.9;
    s.globalCompositeOperation = "lighter";
    s.globalAlpha = 1;

    // Settled particles, drawn a colour at a time.
    for (const g of this.colorGroups) {
      s.fillStyle = g.color;
      for (let j = 0; j < g.idx.length; j++) {
        const i = g.idx[j];
        const m = this.mode[i];
        if (m !== HELD && !(m === ABSORB && t < this.absorbAt[i])) continue;
        s.fillRect(this.px[i] - held / 2, this.py[i] - held / 2, held, held);
      }
    }

    // Eyes burn brighter while it speaks.
    const since = t - this.pulseAt;
    const glow = 0.5 + (since >= 0 ? 0.5 * Math.exp(-since * 2.5) : 0);
    s.fillStyle = "#FF5A00";
    s.globalAlpha = glow;
    for (let i = 0; i < this.N; i++) {
      if (!this.lid[i] || this.mode[i] !== HELD) continue;
      s.fillRect(this.px[i] - held / 2, this.py[i] - held / 2, held, held);
    }
    s.globalAlpha = 1;

    // In flight: colour by speed, hot white to gold.
    for (let b = 0; b < HEAT.length + 1; b++) {
      s.fillStyle = b < HEAT.length ? HEAT[b] : "#F9A615";
      for (let i = 0; i < this.N; i++) {
        const m = this.mode[i];
        let size: number;
        if (m === BURST || m === SEEK) {
          const sp = Math.hypot(this.vx[i], this.vy[i]);
          const bucket = sp > 700 ? 0 : sp > 300 ? 1 : sp > 90 ? 2 : 3;
          if (bucket !== b) continue;
          size = held * (bucket === 3 ? 0.95 : 0.55 + bucket * 0.12);
        } else if (m === ABSORB && t >= this.absorbAt[i]) {
          if (b !== 1) continue;
          const u = clamp01((t - this.absorbAt[i]) / this.absorbDur[i]);
          size = held * (1 - 0.7 * u);
        } else continue;
        s.fillRect(this.px[i] - size / 2, this.py[i] - size / 2, size, size);
      }
    }
    s.globalCompositeOperation = "source-over";
  }

  private drawSparks(s: CanvasRenderingContext2D): void {
    s.globalCompositeOperation = "lighter";
    let current = -1;
    for (let i = 0; i < this.sparkCount; i++) {
      const color = this.sColor[i];
      if (color !== current) {
        current = color;
        s.fillStyle = this.sparkColors[color];
      }
      const f = this.sLife[i] / this.sMax[i];
      s.globalAlpha = f < 0.4 ? f / 0.4 : 1;
      const size = this.sSize[i] * (f < 0.4 ? 0.5 + f * 1.25 : 1);
      s.fillRect(this.sX[i] - size / 2, this.sY[i] - size / 2, size, size);
    }
    s.globalAlpha = 1;
    s.globalCompositeOperation = "source-over";
  }

  private drawRings(s: CanvasRenderingContext2D): void {
    s.globalCompositeOperation = "lighter";
    for (const r of this.rings) {
      const f = r.life / r.max;
      s.globalAlpha = f;
      s.strokeStyle = r.color;
      s.lineWidth = Math.max(0.5, r.width * f);
      s.beginPath();
      s.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      s.stroke();
    }
    s.globalAlpha = 1;
    s.globalCompositeOperation = "source-over";
  }

  private drawAnchorGlow(s: CanvasRenderingContext2D): void {
    const p = this.absorbed / this.N;
    const r = 24 + 110 * p;
    const g = s.createRadialGradient(this.ax, this.ay, 0, this.ax, this.ay, r);
    g.addColorStop(0, `rgba(255,246,224,${0.35 + 0.6 * p})`);
    g.addColorStop(0.4, `rgba(251,193,91,${0.25 + 0.4 * p})`);
    g.addColorStop(1, "rgba(249,166,21,0)");
    s.globalCompositeOperation = "lighter";
    s.fillStyle = g;
    s.fillRect(this.ax - r, this.ay - r, r * 2, r * 2);
    s.globalCompositeOperation = "source-over";
  }
}
