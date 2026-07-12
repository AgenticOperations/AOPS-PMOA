'use client';

import { useMemo, useState } from 'react';
import type { ActivityItem, AgentActivityFeed, AgentActivityFeedItem } from '@/lib/identity-spine-types';
import { formatUtcDateTime } from '@/lib/date-format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AgentLiveActivity } from './AgentLiveActivity';
import { AgentTablePager } from './AgentTablePager';

type HistoryMode = 'runtime' | 'configuration';
type EvidenceSelection =
  | { readonly kind: 'runtime'; readonly item: AgentActivityFeedItem }
  | { readonly kind: 'configuration'; readonly item: ActivityItem };

const PAGE_SIZE = 10;

function titleCase(value: string): string {
  return value
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function outcomeClass(value: string): string {
  const normalized = value.toLowerCase().replaceAll('-', '_');
  if (['deny', 'error', 'expired', 'failed', 'rejected', 'revoked'].some((state) => normalized.includes(state))) return 'danger';
  if (['approval', 'pending', 'queued', 'warning', 'rate_limited'].some((state) => normalized.includes(state))) return 'warning';
  if (normalized.includes('observe')) return 'info';
  return 'active';
}

export function AgentActivityWorkspace({
  activity,
  feed,
  pollUrl,
}: {
  readonly activity: ActivityItem[];
  readonly feed: AgentActivityFeed;
  readonly pollUrl?: string | undefined;
}) {
  const [mode, setMode] = useState<HistoryMode>('runtime');
  const [query, setQuery] = useState('');
  const [runtimePage, setRuntimePage] = useState(1);
  const [configurationPage, setConfigurationPage] = useState(1);
  const [evidence, setEvidence] = useState<EvidenceSelection | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const runtimeRows = useMemo(
    () => feed.events.filter((item) => normalizedQuery.length === 0 || [item.summary, item.action, item.category, item.outcome, item.subject ?? ''].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [feed.events, normalizedQuery],
  );
  const configurationRows = useMemo(
    () => activity.filter((item) => normalizedQuery.length === 0 || [item.summary, item.action, item.eventDomain, item.outcome, item.subject ?? ''].some((value) => value.toLowerCase().includes(normalizedQuery))),
    [activity, normalizedQuery],
  );
  const activePage = mode === 'runtime' ? runtimePage : configurationPage;
  const activeRows = mode === 'runtime' ? runtimeRows : configurationRows;
  const pagedRuntime = runtimeRows.slice((runtimePage - 1) * PAGE_SIZE, runtimePage * PAGE_SIZE);
  const pagedConfiguration = configurationRows.slice((configurationPage - 1) * PAGE_SIZE, configurationPage * PAGE_SIZE);

  const updateQuery = (value: string) => {
    setQuery(value);
    setRuntimePage(1);
    setConfigurationPage(1);
  };

  return (
    <section className="agent-history-canvas" aria-labelledby="agent-history-title">
      <div className="agent-section-heading">
        <div>
          <h2 id="agent-history-title">Agent activity</h2>
          <p>Review recorded runtime evidence or configuration changes for this identity.</p>
        </div>
        <AgentLiveActivity initialFeed={feed} pollUrl={pollUrl} />
      </div>

      <nav aria-label="Agent history type" className="agent-history-tabs">
        <button aria-current={mode === 'runtime' ? 'page' : undefined} className={mode === 'runtime' ? 'is-active' : undefined} onClick={() => setMode('runtime')} type="button">Runtime history</button>
        <button aria-current={mode === 'configuration' ? 'page' : undefined} className={mode === 'configuration' ? 'is-active' : undefined} onClick={() => setMode('configuration')} type="button">Configuration history</button>
      </nav>

      <div className="agent-history-toolbar">
        <input aria-label="Search agent history" onChange={(event) => updateQuery(event.target.value)} placeholder="Search events, actions or resources..." type="search" value={query} />
        <span>{activeRows.length} recorded</span>
      </div>

      {activeRows.length === 0 ? (
        <div className="agent-table-empty">
          <strong>No {mode} events found</strong>
          <span>{query.length > 0 ? 'Clear the search to review all recorded evidence.' : 'Managed activity will appear here after agentOps records it.'}</span>
        </div>
      ) : (
        <>
          <TableShell className="agent-record-table-shell" maxHeight={620}>
            <Table aria-label={`${titleCase(mode)} history`} className="agent-record-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>{mode === 'runtime' ? 'Connection' : 'Actor'}</TableHead>
                  <TableHead>Recorded</TableHead>
                  <TableHead aria-label="Evidence" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {mode === 'runtime'
                  ? pagedRuntime.map((item) => (
                      <TableRow key={`${item.source}:${item.id}`}>
                        <TableCell data-label="Event"><div className="agent-event-cell"><strong>{item.summary}</strong><span>{titleCase(item.action)}</span></div></TableCell>
                        <TableCell data-label="Domain">{titleCase(item.category)}</TableCell>
                        <TableCell data-label="Outcome"><span className={`agent-status-badge is-${outcomeClass(item.outcome)}`}>{titleCase(item.outcome)}</span></TableCell>
                        <TableCell data-label="Connection"><code>{item.connectionId ?? 'System'}</code></TableCell>
                        <TableCell data-label="Recorded"><time dateTime={item.occurredAt}>{formatUtcDateTime(item.occurredAt)}</time></TableCell>
                        <TableCell className="agent-row-action" data-label=""><button onClick={() => setEvidence({ kind: 'runtime', item })} type="button">Evidence <span aria-hidden="true">→</span></button></TableCell>
                      </TableRow>
                    ))
                  : pagedConfiguration.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell data-label="Event"><div className="agent-event-cell"><strong>{item.summary}</strong><span>{titleCase(item.action)}</span></div></TableCell>
                        <TableCell data-label="Domain">{titleCase(item.eventDomain)}</TableCell>
                        <TableCell data-label="Outcome"><span className={`agent-status-badge is-${outcomeClass(item.outcome)}`}>{titleCase(item.outcome)}</span></TableCell>
                        <TableCell data-label="Actor"><code>{titleCase(item.actorType)}</code></TableCell>
                        <TableCell data-label="Recorded"><time dateTime={item.recordedAt}>{formatUtcDateTime(item.recordedAt)}</time></TableCell>
                        <TableCell className="agent-row-action" data-label=""><button onClick={() => setEvidence({ kind: 'configuration', item })} type="button">Evidence <span aria-hidden="true">→</span></button></TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          </TableShell>
          <AgentTablePager
            itemLabel={`${mode} history`}
            onPageChange={mode === 'runtime' ? setRuntimePage : setConfigurationPage}
            page={activePage}
            pageSize={PAGE_SIZE}
            total={activeRows.length}
          />
        </>
      )}

      <Sheet labelledBy="agent-evidence-title" onOpenChange={(open) => !open && setEvidence(null)} open={evidence !== null} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div><SheetTitle id="agent-evidence-title">Recorded evidence</SheetTitle><SheetDescription>Source-backed fields captured for this agent event.</SheetDescription></div>
          <SheetCloseButton onClick={() => setEvidence(null)} />
        </SheetHeader>
        {evidence !== null ? (
          <SheetBody>
            <dl className="agent-drawer-definitions">
              <div><dt>Event</dt><dd>{evidence.item.summary}</dd></div>
              <div><dt>Action</dt><dd>{titleCase(evidence.item.action)}</dd></div>
              <div><dt>Outcome</dt><dd>{titleCase(evidence.item.outcome)}</dd></div>
              <div><dt>Recorded</dt><dd>{formatUtcDateTime(evidence.kind === 'runtime' ? evidence.item.occurredAt : evidence.item.recordedAt)}</dd></div>
              <div><dt>Evidence ID</dt><dd><code>{evidence.item.id}</code></dd></div>
            </dl>
            {evidence.kind === 'runtime' ? <pre className="agent-evidence-payload">{JSON.stringify(evidence.item.payload, null, 2)}</pre> : null}
          </SheetBody>
        ) : null}
      </Sheet>
    </section>
  );
}
