import type { ReactNode } from "react";

export function ChartCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 sm:p-6">
      {children}
    </div>
  );
}
