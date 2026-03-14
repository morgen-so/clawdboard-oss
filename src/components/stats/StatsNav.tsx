"use client";

import { Link, usePathname } from "@/i18n/navigation";

const LINKS = [
  { href: "/stats", label: "Overview" },
  { href: "/stats/tools", label: "Tools" },
] as const;

export function StatsNav() {
  const pathname = usePathname();

  // Determine active state: exact match for /stats, startsWith for /stats/tools
  function isActive(href: string) {
    if (href === "/stats") return pathname === "/stats";
    return pathname.startsWith(href);
  }

  return (
    <nav className="mb-8 flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      {LINKS.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded-md px-3 py-1.5 font-mono text-xs font-medium transition-colors ${
              active
                ? "bg-accent text-background"
                : "text-muted hover:text-foreground hover:bg-surface-hover"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
