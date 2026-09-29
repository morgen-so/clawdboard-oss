// ─── CLAWD PRIME, THE FIRST MOLT ────────────────────────────────────────────
// One bitmap, two renderers: the canvas stage assembles the deity from ~2,000
// particles, and <PixelCrab> draws the same sprite as SVG for the crab rave.
// It has seen the end of all things and it is not pleased to see you.
//
//   C claw   J claw tooth   A arm   B shell   X molten crack   K spike
//   E eye   S eyestalk   T fang   F furnace maw   L leg
//   P pupil (left empty, so it reads as the black behind)   . nothing
//
// Do not question the geometry.

export const CRAB_ROWS = [
  "C.........C..................C.........C",
  "CC.......CC..................CC.......CC",
  "CCC.....CCC..................CCC.....CCC",
  "CCJJ...JJCC..................CCJJ...JJCC",
  "CCC.J.J.CCC..................CCC.J.J.CCC",
  ".CCC...CCC....................CCC...CCC.",
  ".CCCCCCCCC....................CCCCCCCCC.",
  "..CCCCCCC...EE............EE...CCCCCCC..",
  "....AAAA....EEEE........EEEE....AAAA....",
  ".....AAA....EEEPEE....EEPEEE....AAA.....",
  "......AAA....EEPE......EPEE....AAA......",
  ".......AA..K..EE..K..K..EE..K..AA.......",
  "........AABKBB.SSBKBBKBSS.BBKBAA........",
  "......BBBBBBBBBBBBBBBBBBBBBXBBBBBB......",
  ".....BBXBBBBBBBBBBBBBBBBBBBBXBBBBBB.....",
  "....BBBBXXBBBBBBBBBBBBBBBBBBXXBBBBBB....",
  "....BBBBBBXBBBBTFTFTTFTFTBBBBBXBBBBB....",
  "..LLBBBBBBXBBBBFFFFFFFFFFBBBBBBBBBBBLL..",
  ".LL..BBBBBBXBBBFTFTFFTFTFBBBBBBBBBB..LL.",
  "LL..LLBBBBBBBBBBXBBBBXBBBBBBBBBBBBLL..LL",
  "L..LL...BBBBBBBXBBBBBBXXBBBBBBBB...LL..L",
  "..LL..LL..BBBBBBBBBBBBBBBBBBBB..LL..LL..",
  ".LL..LL..........................LL..LL.",
  "LL..LL............................LL..LL",
] as const;

export const CRAB_W = CRAB_ROWS[0].length;
export const CRAB_H = CRAB_ROWS.length;

export type CrabPart = "claw" | "shell" | "eye" | "leg";

export interface CrabPixel {
  /** Column and row in the bitmap. */
  col: number;
  row: number;
  /** The legend character, for the few things that care (eyes, cracks). */
  ch: string;
  part: CrabPart;
  /** -1 for the crab's left half (viewer's left), +1 for the right. */
  side: -1 | 1;
  color: string;
}

// Scorched crimson, darkening to dried blood at the belly. Bone for the teeth
// fangs, molten gold where the shell has cracked.
const SHELL_RAMP = ["#B81E1E", "#A31919", "#8F1616", "#7D1313", "#6B1010", "#5A0D0D"];
const CLAW_RAMP = ["#D42A1C", "#BD1E18", "#A51717", "#8E1414"];
const BONE = "#F3E2CC";

function ramp(stops: string[], t: number): string {
  return stops[Math.min(stops.length - 1, Math.max(0, Math.floor(t * stops.length)))];
}

function colorFor(ch: string, row: number, col: number): string {
  switch (ch) {
    case "E":
      return "#FFC21A";
    case "S":
      return "#7D1313";
    case "L":
      return "#6B1010";
    case "T":
      return BONE;
    case "J":
      return "#5A0D0D";
    case "K":
      return "#A31919";
    case "F":
      return "#E0480E";
    case "X":
      return (row + col) % 2 ? "#FFB23F" : "#FF7A1A";
    case "C":
    case "A":
      return ramp(CLAW_RAMP, row / 12);
    default:
      return ramp(SHELL_RAMP, (row - 12) / 10);
  }
}

function partFor(ch: string): CrabPart {
  if (ch === "C" || ch === "A" || ch === "J") return "claw";
  if (ch === "E" || ch === "S") return "eye";
  if (ch === "L") return "leg";
  return "shell";
}

/** Every filled pixel of the sprite, top-left to bottom-right. */
export const CRAB_PIXELS: CrabPixel[] = CRAB_ROWS.flatMap((line, row) =>
  [...line].flatMap((ch, col): CrabPixel[] =>
    ch === "." || ch === "P"
      ? []
      : [
          {
            col,
            row,
            ch,
            part: partFor(ch),
            side: col < CRAB_W / 2 ? -1 : 1,
            color: colorFor(ch, row, col),
          },
        ]
  )
);
