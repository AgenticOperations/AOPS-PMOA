'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { IconGitCommit, IconGitPullRequest, IconLoader2 } from '@tabler/icons-react';
import { fetchTimeline } from '@/lib/changelog-client';
import type { TimelineActivity } from '@/lib/changelog-types';

type ActivityTimelineProps = {
  readonly repo: string;
};

/**
 * Live, newest-first feed of the repo's real commit + PR activity, merged
 * from `/v1/changelog/timeline`. Distinct from the original design's
 * hardcoded narrative "ChangelogHotTimeline" milestones (product-specific
 * marketing copy for a different app) -- this renders the actual synced
 * GitHub history instead.
 */
export function ActivityTimeline({ repo }: ActivityTimelineProps) {
  const [items, setItems] = useState<readonly TimelineActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchTimeline({ repo, limit: 30 })
      .then((result) => {
        if (!cancelled) setItems(result.data);
      })
      .catch((fetchError: unknown) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Timeline could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [repo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <IconLoader2 className="animate-spin text-[var(--aops-blue-light)]" size={24} />
      </div>
    );
  }

  if (error !== null) {
    return <p className="text-sm text-[#ff8a8a]">{error}</p>;
  }

  if (items.length === 0) {
    return <p className="text-sm text-[var(--aops-muted)]">No recent activity for this repository yet.</p>;
  }

  return (
    <ol className="relative border-l border-[var(--aops-line-strong)] pl-6 space-y-6">
      {items.map((item) => (
        <li className="relative" key={item.id}>
          <span
            className={`aops-keep-round absolute -left-[29px] top-1 flex h-6 w-6 items-center justify-center border-2 border-[#0d0d0d] ${
              item.kind === 'commit' ? 'bg-[var(--aops-blue)] text-white' : 'bg-[#a855f7] text-white'
            }`}
          >
            {item.kind === 'commit' ? <IconGitCommit size={13} /> : <IconGitPullRequest size={13} />}
          </span>
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-medium text-[var(--aops-ink)]">
              {item.kind === 'commit' ? item.raw.commit.message.split('\n')[0] : item.raw.title}
            </p>
            <time className="shrink-0 text-xs text-[var(--aops-faint)] tabular-nums">{format(new Date(item.occurredAt), 'MMM d, yyyy')}</time>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--aops-muted)] flex-wrap">
            <span className="font-medium text-[var(--aops-ink)]">{item.author}</span>
            <span className="opacity-30">•</span>
            <span className="bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 text-[10px]">{item.repoName}</span>
            {item.kind === 'pull_request' && (
              <>
                <span className="opacity-30">•</span>
                <a
                  className="text-[var(--aops-blue-light)] hover:text-white font-mono"
                  href={item.raw.html_url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  #{item.raw.number}
                </a>
              </>
            )}
            {item.kind === 'commit' && (
              <>
                <span className="opacity-30">•</span>
                <a
                  className="text-[var(--aops-blue-light)] hover:text-white font-mono"
                  href={item.raw.html_url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item.raw.sha.substring(0, 7)}
                </a>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
