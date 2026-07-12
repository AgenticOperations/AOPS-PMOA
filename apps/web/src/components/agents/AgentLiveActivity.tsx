'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconActivityHeartbeat } from '@tabler/icons-react';
import type { AgentActivityFeed, AgentActivityFeedItem } from '@/lib/identity-spine-types';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type AgentLiveActivityProps = {
  readonly initialFeed: AgentActivityFeed;
  readonly pollIntervalMs?: number | undefined;
  readonly pollUrl?: string | undefined;
};

function liveLabel(status: AgentActivityFeed['live']['status']): string {
  if (status === 'active') return 'Live now';
  if (status === 'idle') return 'Idle';
  return 'Offline';
}

function formatCategory(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatTime(value: string | null): string {
  if (value === null) return 'No activity yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid timestamp';
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

function outcomeClass(value: string): string {
  const normalized = value.toLowerCase().replaceAll('-', '_');
  if (['denied', 'error', 'expired', 'failed', 'rejected', 'revoked'].some((state) => normalized.includes(state))) {
    return 'outcome-danger';
  }
  if (['approval', 'pending', 'queued', 'warning'].some((state) => normalized.includes(state))) {
    return 'outcome-warning';
  }
  return 'outcome-success';
}

function eventKey(item: AgentActivityFeedItem): string {
  return `${item.source}:${item.id}`;
}

function pageIsHidden(): boolean {
  return document.visibilityState === 'hidden';
}

export function AgentLiveActivity({ initialFeed, pollIntervalMs = 5000, pollUrl }: AgentLiveActivityProps) {
  const [feed, setFeed] = useState<AgentActivityFeed>(initialFeed);
  const [open, setOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('Waiting to start');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pollingGenerationRef = useRef(0);

  const clearPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  useEffect(() => {
    if (!open || pollUrl === undefined) return undefined;
    const generation = ++pollingGenerationRef.current;
    let cancelled = false;

    const refresh = async () => {
      if (cancelled || pollingGenerationRef.current !== generation || pageIsHidden()) {
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const response = await fetch(pollUrl, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`Activity feed failed with ${response.status}`);
        const nextFeed = (await response.json()) as AgentActivityFeed;
        if (!cancelled && pollingGenerationRef.current === generation) {
          setFeed(nextFeed);
          setUpdatedAt(new Date().toISOString());
          setStatusText('Watching');
        }
      } catch (error) {
        if (!cancelled && pollingGenerationRef.current === generation && !(error instanceof DOMException && error.name === 'AbortError')) {
          setStatusText('Reconnecting');
        }
      } finally {
        if (!cancelled && pollingGenerationRef.current === generation && !pageIsHidden()) {
          timerRef.current = setTimeout(() => void refresh(), pollIntervalMs);
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearPolling();
        setStatusText('Paused while hidden');
      } else {
        setStatusText('Refreshing');
        void refresh();
      }
    };

    setStatusText('Connecting');
    void refresh();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      pollingGenerationRef.current += 1;
      document.removeEventListener('visibilitychange', handleVisibility);
      clearPolling();
    };
  }, [clearPolling, open, pollIntervalMs, pollUrl]);

  const recentEvents = useMemo(() => feed.events.slice(0, 20), [feed.events]);

  return (
    <>
      <button className="agent-live-monitor-trigger" onClick={() => setOpen(true)} type="button">
        <span className={`agent-live-indicator is-${feed.live.status}`} aria-hidden="true" />
        <IconActivityHeartbeat aria-hidden="true" size={15} stroke={1.8} />
        Open live monitor
      </button>
      <Sheet labelledBy="live-monitor-title" onOpenChange={setOpen} open={open} panelClassName="live-monitor-sheet">
        <SheetHeader>
          <div>
            <SheetTitle id="live-monitor-title">Live monitor</SheetTitle>
            <SheetDescription>Runtime evidence refreshes only while this drawer remains open.</SheetDescription>
          </div>
          <SheetCloseButton onClick={() => setOpen(false)} />
        </SheetHeader>
        <SheetBody>
          <div className="agent-live-monitor-summary" role="status">
            <div><span>Status</span><strong><i className={`agent-live-indicator is-${feed.live.status}`} />{liveLabel(feed.live.status)}</strong></div>
            <div><span>Stream</span><strong>{statusText}</strong></div>
            <div><span>Last refresh</span><strong><time dateTime={updatedAt ?? undefined}>{updatedAt === null ? 'Initial evidence' : formatTime(updatedAt)}</time></strong></div>
          </div>
          {recentEvents.length === 0 ? (
            <div className="agent-table-empty agent-live-empty">
              <strong>Waiting for managed activity</strong>
              <span>Only actions recorded through agentOps API, MCP, policy, approval, or payment surfaces appear.</span>
            </div>
          ) : (
            <ActivityEvents events={recentEvents} />
          )}
        </SheetBody>
      </Sheet>
    </>
  );
}

function ActivityEvents({ events }: { readonly events: readonly AgentActivityFeedItem[] }) {
  return (
    <ol className="agent-live-event-list">
      {events.map((item) => (
        <li className={`is-${outcomeClass(item.outcome).replace('outcome-', '')}`} key={eventKey(item)}>
          <div className="agent-live-event-main">
            <strong>{item.summary}</strong>
            {item.subject !== null ? <span>{item.subject}</span> : null}
            {item.description !== null ? <span>{item.description}</span> : null}
          </div>
          <div className="agent-live-event-meta">
            <span>{formatCategory(item.category)}</span>
            <strong className={outcomeClass(item.outcome)}>{formatCategory(item.outcome)}</strong>
            {item.approvalId !== null ? <span>{item.approvalId}</span> : null}
            {item.decisionId !== null ? <span>{item.decisionId}</span> : null}
            <time dateTime={item.occurredAt}>{formatTime(item.occurredAt)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}
