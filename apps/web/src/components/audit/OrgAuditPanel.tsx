import type { AuditEventDomain, AuditEventRecord } from '@/lib/audit-types';

type OrgAuditPanelProps = {
  readonly title: string;
  readonly description: string;
  readonly events: readonly AuditEventRecord[];
  readonly domains?: readonly AuditEventDomain[] | undefined;
  readonly emptyText?: string | undefined;
};

function titleCase(value: string): string {
  return value
    .split(/[_\s.]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function eventLabel(event: AuditEventRecord): string {
  const resource = event.resourceType === null ? null : `${event.resourceType}${event.resourceId === null ? '' : `:${event.resourceId}`}`;
  return resource ?? event.sourceSystem ?? event.eventType;
}

export function OrgAuditPanel({
  title,
  description,
  events,
  domains,
  emptyText = 'No audit events have been recorded for this surface yet.',
}: OrgAuditPanelProps) {
  const visibleEvents =
    domains === undefined || domains.length === 0 ? events : events.filter((event) => domains.includes(event.eventDomain));

  return (
    <section className="org-audit-panel" aria-labelledby={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`}>
      <div className="org-audit-heading">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h2 id={`${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
        <span>{visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'}</span>
      </div>

      {visibleEvents.length === 0 ? (
        <div className="org-audit-empty">{emptyText}</div>
      ) : (
        <div className="org-audit-list">
          {visibleEvents.slice(0, 8).map((event) => (
            <article className="org-audit-row" key={event.id}>
              <div>
                <strong>{titleCase(event.action)}</strong>
                <span>{eventLabel(event)}</span>
              </div>
              <div>
                <span className={`org-audit-outcome audit-${event.outcome}`}>{event.outcome}</span>
                <span>{titleCase(event.eventDomain)}</span>
                <time dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleString()}</time>
              </div>
              <code>{event.eventHash.slice(0, 18)}...</code>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
