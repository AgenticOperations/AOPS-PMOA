'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { IconBrandGithub, IconGitBranch, IconGitMerge } from '@tabler/icons-react';
import type { ChangelogBranchInfo, ChangelogContributor, ChangelogGraphCommit } from '@/lib/changelog-types';

/**
 * Pixel-matched port of the original `CustomGitGraph` bezier-lane SVG commit
 * graph. Layout constants, lane-reservation algorithm, and the orthogonal
 * U-path bezier logic are intentionally identical to the source so the
 * rendered graph looks the same, just re-typed against this repo's
 * `ChangelogGraphCommit` / `ChangelogBranchInfo` shapes instead of raw
 * GitHub payloads.
 */

const COLUMN_WIDTH = 48;
const ROW_HEIGHT = 64;
const NODE_RADIUS = 8;
const LINE_THICKNESS = 4;
const BEND_RADIUS = 14;
const SVG_PADDING_LEFT = 40;

const BRANCH_COLORS: Record<string, string> = {
  main: '#0969da',
  master: '#0969da',
  dev: '#2da44e',
  development: '#2da44e',
  staging: '#8250df',
};
const PALETTE = ['#cf222e', '#bf3989', '#d4a72c', '#1b7c83', '#4a235a', '#f66a0a', '#0366d6'];

function getBranchColor(name: string, index: number): string {
  const key = name.toLowerCase();
  return BRANCH_COLORS[key] ?? PALETTE[index % PALETTE.length] ?? '#0366d6';
}

function AuthorAvatar({ name, url, color }: { readonly name: string; readonly url?: string | undefined; readonly color: string }) {
  const [avatarData, setAvatarData] = useState<string | null>(null);
  const cacheKey = `git_avatar_${name.replace(/\s+/g, '_').toLowerCase()}`;

  useEffect(() => {
    if (url === undefined || url.length === 0) return;
    const cached = window.localStorage.getItem(cacheKey);
    if (cached !== null) {
      setAvatarData(cached);
      return;
    }
    fetch(url)
      .then((response) => response.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result as string;
          try {
            window.localStorage.setItem(cacheKey, base64);
          } catch {
            // Storage quota exceeded -- degrade to initials silently.
          }
          setAvatarData(base64);
        };
        reader.readAsDataURL(blob);
      })
      .catch(() => {});
  }, [url, cacheKey]);

  return (
    <div className="w-10 h-10 flex-shrink-0 overflow-hidden border border-[rgba(255,255,255,0.14)] relative bg-[rgba(255,255,255,0.04)] transition-all group-hover:scale-110">
      {avatarData !== null ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={name} className="w-full h-full object-cover" src={avatarData} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-white" style={{ backgroundColor: color }}>
          {name.substring(0, 2).toUpperCase()}
        </div>
      )}
    </div>
  );
}

type CommitGraphProps = {
  readonly commits: readonly ChangelogGraphCommit[];
  readonly branches: readonly ChangelogBranchInfo[];
  readonly contributors: readonly ChangelogContributor[];
};

type LaneBranch = { readonly name: string; readonly color: string };
type GraphNode = ChangelogGraphCommit & {
  readonly lane: number;
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly heads: readonly LaneBranch[];
  readonly avatarUrl?: string | undefined;
};

export function CommitGraph({ commits, branches, contributors }: CommitGraphProps) {
  const graphData = useMemo(() => {
    if (commits.length === 0) return null;

    const avatarMap = new Map(contributors.map((contributor) => [contributor.name, contributor.avatarUrl]));
    const shaToCommit = new Map(commits.map((commit) => [commit.sha, commit]));
    const shaToLane = new Map<string, number>();
    const headLabels = new Map<string, LaneBranch[]>();

    const branchesWithHead = branches.filter(
      (branch): branch is ChangelogBranchInfo & { readonly lastCommitSha: string } => branch.lastCommitSha !== null,
    );

    const sortedBranches = [...branchesWithHead].sort((a, b) => {
      const priority: Record<string, number> = { main: 0, master: 0, dev: 1 };
      return (priority[a.name.toLowerCase()] ?? 99) - (priority[b.name.toLowerCase()] ?? 99);
    });

    const legend = sortedBranches.map((branch, index) => {
      const color = getBranchColor(branch.name, index);
      const labels = headLabels.get(branch.lastCommitSha) ?? [];
      headLabels.set(branch.lastCommitSha, [...labels, { name: branch.name, color }]);

      let currentSha: string | undefined = branch.lastCommitSha;
      while (currentSha !== undefined && shaToCommit.has(currentSha)) {
        if (!shaToLane.has(currentSha)) shaToLane.set(currentSha, index);
        currentSha = shaToCommit.get(currentSha)?.parents[0]?.sha;
      }
      return { name: branch.name, color };
    });

    const nodes: GraphNode[] = commits.map((commit, i) => {
      const lane = shaToLane.get(commit.sha) ?? sortedBranches.length;
      const color = getBranchColor(sortedBranches[lane]?.name ?? 'feature', lane);

      return {
        ...commit,
        lane,
        color,
        x: lane * COLUMN_WIDTH + SVG_PADDING_LEFT,
        y: i * ROW_HEIGHT + ROW_HEIGHT / 2,
        heads: headLabels.get(commit.sha) ?? [],
        avatarUrl: avatarMap.get(commit.commit.author.name),
      };
    });

    return {
      nodes,
      nodeMap: new Map(nodes.map((node) => [node.sha, node])),
      legend,
      totalWidth: (Math.max(...nodes.map((node) => node.lane)) + 1) * COLUMN_WIDTH + 80,
      totalHeight: commits.length * ROW_HEIGHT,
    };
  }, [commits, branches, contributors]);

  if (graphData === null) return null;

  return (
    <div className="flex flex-col border border-[var(--aops-line-strong)] bg-[var(--aops-panel)] h-[150vh] overflow-hidden antialiased font-sans">
      <div className="px-8 py-5 border-b border-[var(--aops-line-strong)] flex items-center justify-between z-10 gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[rgba(80,100,255,0.1)] text-[var(--aops-blue-light)]">
            <IconGitBranch size={20} />
          </div>
          <div>
            <span className="block text-[10px] font-medium text-[var(--aops-faint)] uppercase tracking-widest leading-none mb-1">Architecture</span>
            <span className="text-sm font-semibold text-[var(--aops-ink)] uppercase tracking-wider">Branch Lanes</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {graphData.legend.map((branch) => (
            <div className="flex items-center gap-2 px-3 py-1.5 border border-[rgba(255,255,255,0.14)] hover:border-[rgba(255,255,255,0.3)] transition-colors cursor-default" key={branch.name}>
              <div className="aops-keep-round w-2 h-2 shadow-[0_0_8px_rgba(255,255,255,0.2)]" style={{ backgroundColor: branch.color }} />
              <span className="text-[10px] font-semibold text-[var(--aops-ink)] uppercase tracking-tight">{branch.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden bg-[rgba(255,255,255,0.015)]">
        <div className="overflow-x-auto border-r border-[var(--aops-line)] select-none no-scrollbar" style={{ width: graphData.totalWidth }}>
          <div className="relative overflow-y-auto h-full no-scrollbar">
            <svg height={graphData.totalHeight} width={graphData.totalWidth}>
              {graphData.nodes.map((node) => (
                <g key={`paths-${node.sha}`}>
                  {node.parents.map((parent, parentIndex) => {
                    const parentNode = graphData.nodeMap.get(parent.sha);
                    if (parentNode === undefined) return null;

                    const color = parentIndex > 0 ? parentNode.color : node.color;

                    if (node.lane === parentNode.lane) {
                      return (
                        <line
                          key={parent.sha}
                          stroke={color}
                          strokeLinecap="round"
                          strokeOpacity={0.4}
                          strokeWidth={LINE_THICKNESS}
                          x1={node.x}
                          x2={parentNode.x}
                          y1={node.y}
                          y2={parentNode.y}
                        />
                      );
                    }

                    const midX = (node.x + parentNode.x) / 2;
                    const yDir = parentNode.y > node.y ? 1 : -1;
                    const xDir = parentNode.x > node.x ? 1 : -1;
                    const safeRadius = Math.min(BEND_RADIUS, Math.abs(parentNode.y - node.y) / 2);

                    const d = `
                      M ${node.x} ${node.y}
                      H ${midX - xDir * safeRadius}
                      Q ${midX} ${node.y}, ${midX} ${node.y + yDir * safeRadius}
                      V ${parentNode.y - yDir * safeRadius}
                      Q ${midX} ${parentNode.y}, ${midX + xDir * safeRadius} ${parentNode.y}
                      H ${parentNode.x}
                    `;

                    return (
                      <path
                        d={d}
                        fill="none"
                        key={parent.sha}
                        stroke={color}
                        strokeDasharray={parentIndex > 0 ? '6 4' : 'none'}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeOpacity={0.35}
                        strokeWidth={LINE_THICKNESS}
                      />
                    );
                  })}
                </g>
              ))}

              {graphData.nodes.map((node) => (
                <g className="group/node cursor-pointer" key={`node-${node.sha}`}>
                  <circle className="opacity-0 group-hover/node:opacity-10 transition-all duration-300" cx={node.x} cy={node.y} fill={node.color} r={NODE_RADIUS + 10} />
                  <circle className="opacity-0 group-hover/node:opacity-40 transition-all duration-300" cx={node.x} cy={node.y} fill="transparent" r={NODE_RADIUS + 4} stroke={node.color} strokeWidth={1.5} />
                  <circle
                    className="transition-all duration-200 group-hover/node:stroke-[6px]"
                    cx={node.x}
                    cy={node.y}
                    fill="#0d0d0d"
                    r={NODE_RADIUS}
                    stroke={node.color}
                    strokeWidth={4}
                  />
                  {node.parents.length > 1 && <circle cx={node.x} cy={node.y} fill={node.color} r={2.5} />}
                </g>
              ))}
            </svg>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-transparent divide-y divide-[var(--aops-line)]">
          {graphData.nodes.map((node) => (
            <div className="flex items-center px-8 hover:bg-[rgba(255,255,255,0.03)] transition-all group" key={node.sha} style={{ height: ROW_HEIGHT }}>
              <AuthorAvatar color={node.color} name={node.commit.author.name} url={node.avatarUrl} />

              <div className="ml-6 flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h4 className="text-[14px] font-medium text-[var(--aops-ink)] truncate tracking-tight uppercase leading-none">
                    {node.commit.message.split('\n')[0]}
                  </h4>
                  <div className="flex gap-1.5">
                    {node.heads.map((head) => (
                      <span className="px-2 py-0.5 text-white text-[9px] font-semibold uppercase border border-black/10" key={head.name} style={{ backgroundColor: head.color }}>
                        {head.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-[11px] text-[var(--aops-faint)] font-medium uppercase tracking-[0.1em]">
                  <span className="text-[var(--aops-muted)] group-hover:text-[var(--aops-blue-light)] transition-colors font-semibold">{node.commit.author.name}</span>
                  <span className="opacity-30">/</span>
                  <a
                    className="flex items-center gap-1.5 text-[var(--aops-blue-light)] hover:text-white bg-[rgba(80,100,255,0.08)] px-2 py-1 border border-[rgba(80,100,255,0.25)] font-mono tracking-normal lowercase transition-all"
                    href={node.html_url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <IconBrandGithub size={12} />
                    {node.sha.substring(0, 7)}
                  </a>
                  <span className="opacity-30">/</span>
                  <span className="tabular-nums font-medium opacity-60 lowercase">{format(new Date(node.commit.author.date), 'MMM dd, HH:mm')}</span>
                </div>
              </div>

              {node.parents.length > 1 && (
                <div className="ml-4 flex items-center gap-2 px-3 py-1.5 bg-[rgba(191,90,242,0.1)] text-[#d9a5ff] border border-[rgba(191,90,242,0.25)] transition-transform group-hover:scale-105">
                  <IconGitMerge size={16} />
                  <span className="text-[10px] font-semibold uppercase">Merge</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
