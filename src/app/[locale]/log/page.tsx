import type { Metadata } from "next";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/layout/Header";
import { logEntries } from "@/lib/log-entries";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://clawdboard.ai";

export const metadata: Metadata = {
  title: "Changelog — What's New on clawdboard",
  description:
    "All the latest features, fixes, and improvements to clawdboard — the Claude Code usage leaderboard. Stay up to date with what's changed.",
  alternates: { canonical: `${BASE_URL}/log` },
};

const TYPE_CONFIG = {
  feature: { label: "feature", color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/10" },
  fix: { label: "fix", color: "text-orange-400", border: "border-orange-400/30", bg: "bg-orange-400/10" },
  improvement: { label: "improvement", color: "text-accent", border: "border-accent/30", bg: "bg-accent-glow" },
} as const;

/** Group entries by month */
function groupByMonth(entries: typeof logEntries) {
  const groups: { month: string; entries: typeof logEntries }[] = [];
  for (const entry of entries) {
    const d = new Date(entry.date + "T00:00:00");
    const month = d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    const last = groups[groups.length - 1];
    if (last?.month === month) {
      last.entries.push(entry);
    } else {
      groups.push({ month, entries: [entry] });
    }
  }
  return groups;
}

export default function LogPage() {
  const groups = groupByMonth(logEntries);

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Changelog" },
    ],
  };

  return (
    <div className="relative min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <Header
        subtitle="changelog"
        rightContent={
          <Link
            href="/"
            className="font-mono text-xs text-muted transition-colors hover:text-accent"
          >
            &larr; back to leaderboard
          </Link>
        }
      />

      <main className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Page heading */}
        <div className="mb-12">
          <h1 className="font-display text-2xl font-bold text-foreground mb-2">
            <span className="text-accent mr-2">&gt;</span>
            Changelog
          </h1>
          <p className="font-mono text-sm text-muted">
            New features, fixes, and improvements to clawdboard.
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gradient-to-b from-accent/40 via-border-bright to-transparent" />

          {groups.map((group) => (
            <div key={group.month} className="mb-12">
              {/* Month header */}
              <div className="relative flex items-center gap-4 mb-6">
                <div className="relative z-10 h-[15px] w-[15px] rounded-full border-2 border-accent bg-background" />
                <h2 className="font-display text-lg font-bold text-foreground">
                  {group.month}
                </h2>
              </div>

              {/* Entries */}
              <div className="ml-[7px] border-l border-border-bright pl-8 space-y-8">
                {group.entries.map((entry, i) => {
                  const config = TYPE_CONFIG[entry.type];
                  const d = new Date(entry.date + "T00:00:00");
                  const day = d.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });

                  return (
                    <article key={`${entry.date}-${i}`} className="group relative">
                      {/* Dot on timeline */}
                      <div className="absolute -left-[calc(2rem+4.5px)] top-[6px] h-[9px] w-[9px] rounded-full bg-border-bright group-hover:bg-accent transition-colors" />

                      {/* Date + type badge */}
                      <div className="flex items-center gap-3 mb-2">
                        <time
                          dateTime={entry.date}
                          className="font-mono text-xs text-dim"
                        >
                          {day}
                        </time>
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${config.color} ${config.border} ${config.bg}`}
                        >
                          {config.label}
                        </span>
                      </div>

                      {/* Title */}
                      <h3 className="font-display text-base font-semibold text-foreground mb-1.5 group-hover:text-accent transition-colors">
                        {entry.title}
                      </h3>

                      {/* Description */}
                      <p className="font-mono text-sm leading-relaxed text-muted">
                        {entry.description}
                      </p>

                      {/* Optional image */}
                      {entry.image && (
                        <div className="mt-4 overflow-hidden rounded-lg border border-border-bright">
                          <Image
                            src={entry.image}
                            alt={entry.title}
                            width={720}
                            height={400}
                            className="w-full h-auto"
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Terminal end marker */}
          <div className="relative flex items-center gap-4">
            <div className="relative z-10 h-[15px] w-[15px] rounded-full border-2 border-border-bright bg-background" />
            <span className="font-mono text-xs text-dim">
              {"// that's everything for now"}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
