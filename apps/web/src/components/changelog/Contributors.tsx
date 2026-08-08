import type { ChangelogContributor } from '@/lib/changelog-types';

type ContributorsProps = {
  readonly contributors: readonly ChangelogContributor[];
};

export function Contributors({ contributors }: ContributorsProps) {
  if (contributors.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-px bg-[var(--aops-line-strong)] border border-[var(--aops-line-strong)]">
      {contributors.map((contributor) => (
        <div
          className="flex items-center gap-3 p-4 bg-[var(--aops-panel)] hover:bg-[rgba(255,255,255,0.03)] transition-colors"
          key={contributor.name}
        >
          <div className="aops-keep-round w-11 h-11 shrink-0 bg-[rgba(255,255,255,0.06)] overflow-hidden flex items-center justify-center text-xs font-semibold text-[var(--aops-faint)]">
            {contributor.avatarUrl.length > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={contributor.name} className="aops-keep-round w-full h-full object-cover" src={contributor.avatarUrl} />
            ) : (
              contributor.name.substring(0, 2).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--aops-ink)] truncate">{contributor.name}</p>
            {contributor.profileUrl.length > 0 && (
              <a
                className="text-xs text-[var(--aops-faint)] hover:text-[var(--aops-blue-light)] transition-colors"
                href={contributor.profileUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                View profile →
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
