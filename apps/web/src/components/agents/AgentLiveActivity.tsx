'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AgentActivityFeed, AgentActivityFeedItem } from '@/lib/identity-spine-types';

type AgentLiveActivityProps = {
  readonly initialFeed: AgentActivityFeed;
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

function eventKey(item: AgentActivityFeedItem): string {
  return `${item.source}:${item.id}`;
}

export function AgentLiveActivity({ initialFeed, pollUrl }: AgentLiveActivityProps) {
  const [feed, setFeed] = useState<AgentActivityFeed>(initialFeed);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>('Watching');

  useEffect(() => {
    if (pollUrl === undefined) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const response = await fetch(pollUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Activity feed failed with ${response.status}`);
        const nextFeed = (await response.json()) as AgentActivityFeed;
        if (!cancelled) {
          setFeed(nextFeed);
          setUpdatedAt(new Date().toISOString());
          setStatusText('Watching');
        }
      } catch {
        if (!cancelled) setStatusText('Reconnecting');
      }
    };

    timer = setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [pollUrl]);

  const recentEvents = useMemo(() => feed.events.slice(0, 20), [feed.events]);

  return (
    <section className="section-block live-activity-panel" aria-labelledby="live-activity-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Runtime stream</p>
          <h2 id="live-activity-title">Live activity</h2>
        </div>
        <div className="live-status-stack">
          <span className={`live-status-dot status-${feed.live.status}`}>{liveLabel(feed.live.status)}</span>
          <span>{statusText}</span>
        </div>
      </div>

      <div className="live-summary-grid">
        <div>
          <span>Last seen</span>
          <strong>{formatTime(feed.live.last_seen_at)}</strong>
        </div>
        <div>
          <span>Latest event</span>
          <strong>{formatTime(feed.live.latest_event_at)}</strong>
        </div>
        <div>
          <span>Active credentials</span>
          <strong>{feed.live.active_connection_count}</strong>
        </div>
        <div>
          <span>Feed updated</span>
          <strong>{updatedAt === null ? 'Initial load' : formatTime(updatedAt)}</strong>
        </div>
      </div>

      {recentEvents.length === 0 ? (
        <div className="soft-row">
          <strong>No runtime activity yet.</strong>
          <span>Policy checks, approvals, MCP records, and runtime onboarding will appear here.</span>
        </div>
      ) : (
        <ol className="activity-list live-activity-list">
          {recentEvents.map((item) => (
            <li key={eventKey(item)}>
              <div className="activity-event-main">
                <strong>{item.summary}</strong>
                {item.subject !== null ? <span className="activity-event-subject">{item.subject}</span> : null}
                {item.description !== null ? <span>{item.description}</span> : null}
              </div>
              <div className="activity-event-meta">
                <span>{formatCategory(item.category)}</span>
                <strong>{formatCategory(item.outcome)}</strong>
                {item.approvalId !== null ? <span>{item.approvalId}</span> : null}
                {item.decisionId !== null ? <span>{item.decisionId}</span> : null}
                <time dateTime={item.occurredAt}>{formatTime(item.occurredAt)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
