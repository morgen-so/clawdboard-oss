export default function Loading() {
  return (
    <div className="relative min-h-screen bg-background">
      {/* Header skeleton */}
      <header className="border-b border-border bg-background/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-6 w-24 animate-pulse rounded bg-surface" />
            <div className="hidden sm:block h-4 w-40 animate-pulse rounded bg-surface" />
          </div>
          <div className="h-8 w-8 animate-pulse rounded-full bg-surface" />
        </div>
        <div className="h-px bg-border" />
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Toggle skeleton */}
        <div className="mb-4 flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded-lg bg-surface" />
          <div className="h-9 w-20 animate-pulse rounded-lg bg-surface" />
        </div>

        {/* Filter row skeleton */}
        <div className="mb-6 flex items-center justify-between">
          <div className="h-6 w-64 animate-pulse rounded bg-surface" />
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 w-14 animate-pulse rounded-md bg-surface" />
            ))}
          </div>
        </div>

        {/* Table skeleton */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {/* Table header */}
          <div className="flex items-center border-b border-border px-4 py-3 gap-4">
            <div className="h-3 w-6 animate-pulse rounded bg-border" />
            <div className="hidden sm:block h-3 w-6 animate-pulse rounded bg-border" />
            <div className="h-3 w-16 animate-pulse rounded bg-border" />
            <div className="ml-auto hidden sm:flex gap-8">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-3 w-14 animate-pulse rounded bg-border" />
              ))}
            </div>
            <div className="ml-auto sm:ml-0 h-3 w-16 animate-pulse rounded bg-border" />
          </div>
          {/* Table rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center border-b border-border/50 px-4 py-3 gap-4"
            >
              <div className="h-4 w-6 animate-pulse rounded bg-border" />
              <div className="hidden sm:block h-4 w-6 animate-pulse rounded bg-border" />
              <div className="flex items-center gap-3">
                <div className="h-7 w-7 animate-pulse rounded-full bg-border" />
                <div className="h-4 w-24 animate-pulse rounded bg-border" />
              </div>
              <div className="ml-auto hidden sm:flex gap-8">
                {Array.from({ length: 4 }).map((_, j) => (
                  <div key={j} className="h-4 w-12 animate-pulse rounded bg-border" />
                ))}
              </div>
              <div className="ml-auto sm:ml-0 h-4 w-20 animate-pulse rounded bg-border" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
