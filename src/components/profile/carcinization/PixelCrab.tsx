import { CRAB_H, CRAB_PIXELS, CRAB_W, type CrabPixel } from "./crab";

// The CLAWD PRIME sprite as crisp SVG, with each claw in its own group so CSS
// can make it snap. Runs of same-coloured pixels merge into one rect.

type Group = "clawL" | "clawR" | "body";

function groupOf(p: CrabPixel): Group {
  if (p.part !== "claw") return "body";
  return p.side < 0 ? "clawL" : "clawR";
}

interface Run {
  x: number;
  y: number;
  w: number;
  color: string;
}

const RUNS: Record<Group, Run[]> = { clawL: [], clawR: [], body: [] };
for (const p of CRAB_PIXELS) {
  const runs = RUNS[groupOf(p)];
  const prev = runs[runs.length - 1];
  if (prev && prev.y === p.row && prev.x + prev.w === p.col && prev.color === p.color) {
    prev.w++;
  } else {
    runs.push({ x: p.col, y: p.row, w: 1, color: p.color });
  }
}

function Rects({ runs }: { runs: Run[] }) {
  return runs.map((r) => (
    <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.color} />
  ));
}

export function PixelCrab({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${CRAB_W} ${CRAB_H}`}
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      <g className="carc-claw-l">
        <Rects runs={RUNS.clawL} />
      </g>
      <g className="carc-claw-r">
        <Rects runs={RUNS.clawR} />
      </g>
      <Rects runs={RUNS.body} />
    </svg>
  );
}
