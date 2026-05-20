/**
 * Loading boundary for the entire /[locale]/dashboard segment.
 *
 * Renders inside the dashboard layout, so the sidebar and header stay
 * visible while the page-level Server Components stream in. This covers
 * all 57 dashboard pages with one file instead of per-page loading.tsx
 * boilerplate.
 *
 * Visual: a centered skeleton block that matches the typical dashboard
 * page header + content grid. Keeps the user's eye fixed on the content
 * area while data resolves.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Page header skeleton — title + subtitle */}
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded-md bg-muted/60" />
      </div>

      {/* Stat cards skeleton — matches the common 4-up KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-border/60 bg-card"
          />
        ))}
      </div>

      {/* Content block skeleton — matches a typical table/list region */}
      <div className="space-y-3 rounded-lg border border-border/60 bg-card p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-10 animate-pulse rounded-md bg-muted/40"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
