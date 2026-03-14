export function StatCard({
  label,
  value,
  sub,
  accent,
  accentColor,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  /** Override the accent color (hex). Falls back to the theme accent. */
  accentColor?: string;
}) {
  // When a custom accentColor is provided with accent=true, use inline styles
  const hasCustomColor = accent && accentColor;

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        accent && !hasCustomColor
          ? "border-accent/30 bg-accent/5 hover:border-accent/50"
          : !accent
            ? "border-border bg-surface hover:border-border-bright"
            : ""
      }`}
      style={
        hasCustomColor
          ? {
              borderColor: `${accentColor}4D`,
              backgroundColor: `${accentColor}0D`,
            }
          : undefined
      }
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted mb-1.5">
        {label}
      </p>
      <p
        className={`font-display text-xl font-bold sm:text-2xl ${
          accent && !hasCustomColor ? "text-accent" : "text-foreground"
        }`}
        style={hasCustomColor ? { color: accentColor } : undefined}
      >
        {value}
      </p>
      <p className="font-mono text-[11px] text-dim mt-1">{sub}</p>
    </div>
  );
}
