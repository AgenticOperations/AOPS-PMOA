import { Skeleton } from '@/components/ui/skeleton';

function MetricSkeleton() {
  return (
    <div className="console-route-skeleton-metric">
      <Skeleton className="console-route-skeleton-line console-route-skeleton-line-sm" />
      <Skeleton className="console-route-skeleton-line console-route-skeleton-line-xl" />
      <Skeleton className="console-route-skeleton-line console-route-skeleton-line-md" />
    </div>
  );
}

function FleetCardSkeleton({ delay }: { readonly delay: number }) {
  return (
    <div className="console-route-skeleton-fleet-card" style={{ animationDelay: `${delay}ms` }}>
      <div className="console-route-skeleton-fleet-hero">
        <Skeleton className="console-route-skeleton-fleet-orb" />
      </div>
      <div className="console-route-skeleton-fleet-body">
        <Skeleton className="console-route-skeleton-line console-route-skeleton-line-lg" />
        <Skeleton className="console-route-skeleton-line console-route-skeleton-line-sm" />
        <Skeleton className="console-route-skeleton-line console-route-skeleton-line-md" />
      </div>
    </div>
  );
}

function PanelRowSkeleton() {
  return (
    <div className="console-route-skeleton-row">
      <Skeleton className="console-route-skeleton-dot" />
      <div className="console-route-skeleton-row-copy">
        <Skeleton className="console-route-skeleton-line console-route-skeleton-line-lg" />
        <Skeleton className="console-route-skeleton-line console-route-skeleton-line-md" />
      </div>
      <Skeleton className="console-route-skeleton-line console-route-skeleton-line-xs" />
    </div>
  );
}

/** Workspace body placeholder while a console section streams in. */
export function ConsoleRouteSkeleton() {
  return (
    <div className="console-route-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading section</span>

      <header className="console-route-skeleton-header">
        <div>
          <Skeleton className="console-route-skeleton-line console-route-skeleton-line-eyebrow" />
          <Skeleton className="console-route-skeleton-line console-route-skeleton-line-title" />
          <Skeleton className="console-route-skeleton-line console-route-skeleton-line-subtitle" />
        </div>
        <Skeleton className="console-route-skeleton-cta" />
      </header>

      <section className="console-route-skeleton-metrics" aria-hidden="true">
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
        <MetricSkeleton />
      </section>

      <section className="console-route-skeleton-fleet" aria-hidden="true">
        <div className="console-route-skeleton-section-head">
          <Skeleton className="console-route-skeleton-line console-route-skeleton-line-section" />
          <Skeleton className="console-route-skeleton-line console-route-skeleton-line-xs" />
        </div>
        <div className="console-route-skeleton-fleet-strip">
          <FleetCardSkeleton delay={0} />
          <FleetCardSkeleton delay={60} />
          <FleetCardSkeleton delay={120} />
          <FleetCardSkeleton delay={180} />
        </div>
      </section>

      <div className="console-route-skeleton-columns" aria-hidden="true">
        <section className="console-route-skeleton-panel">
          <div className="console-route-skeleton-section-head">
            <Skeleton className="console-route-skeleton-line console-route-skeleton-line-section" />
            <Skeleton className="console-route-skeleton-pill" />
          </div>
          <PanelRowSkeleton />
          <PanelRowSkeleton />
          <PanelRowSkeleton />
        </section>
        <section className="console-route-skeleton-panel">
          <div className="console-route-skeleton-section-head">
            <Skeleton className="console-route-skeleton-line console-route-skeleton-line-section" />
            <Skeleton className="console-route-skeleton-line console-route-skeleton-line-xs" />
          </div>
          <PanelRowSkeleton />
          <PanelRowSkeleton />
          <PanelRowSkeleton />
        </section>
      </div>
    </div>
  );
}
