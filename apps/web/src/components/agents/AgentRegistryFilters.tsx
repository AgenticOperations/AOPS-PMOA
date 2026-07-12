'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AgentStatus, TeamRecord } from '@/lib/identity-spine-types';
import { formatStatus } from './format';

type AgentRegistryFiltersProps = {
  readonly applied: {
    readonly pageSize: number;
    readonly search: string;
    readonly status: AgentStatus | '';
    readonly team: string;
  };
  readonly orgSlug: string;
  readonly pageSizes: readonly number[];
  readonly statuses: readonly AgentStatus[];
  readonly teams: readonly TeamRecord[];
};

export function AgentRegistryFilters({ applied, orgSlug, pageSizes, statuses, teams }: AgentRegistryFiltersProps) {
  const [search, setSearch] = useState(applied.search);
  const [team, setTeam] = useState(applied.team);
  const [status, setStatus] = useState<AgentStatus | ''>(applied.status);
  const [pageSize, setPageSize] = useState(applied.pageSize);
  const dirty = search !== applied.search || team !== applied.team || status !== applied.status || pageSize !== applied.pageSize;
  const hasAppliedFilters = applied.search.length > 0 || applied.team.length > 0 || applied.status.length > 0 || applied.pageSize !== 25;

  return (
    <form action={`/app/${orgSlug}/agents`} className="registry-toolbar" role="search">
      <div className="registry-toolbar-fields">
        <label className="registry-search-field"><span className="sr-only">Search agents</span><input aria-label="Search agents" name="search" onChange={(event) => setSearch(event.target.value)} placeholder="Search agent, team or ID..." type="search" value={search} /></label>
        <label className="registry-filter-field"><span className="sr-only">Team</span><select aria-label="Team" name="team" onChange={(event) => setTeam(event.target.value)} value={team}><option value="">All teams</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="registry-filter-field"><span className="sr-only">Status</span><select aria-label="Status" name="status" onChange={(event) => setStatus(event.target.value as AgentStatus | '')} value={status}><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{formatStatus(item)}</option>)}</select></label>
        <label className="registry-filter-field registry-page-size-field"><span className="sr-only">Rows per page</span><select aria-label="Rows per page" name="page_size" onChange={(event) => setPageSize(Number(event.target.value))} value={pageSize}>{pageSizes.map((size) => <option key={size} value={size}>{size} rows</option>)}</select></label>
      </div>
      {dirty || hasAppliedFilters ? (
        <div className="registry-toolbar-actions">
          {hasAppliedFilters ? <Link className="registry-clear-link" href={`/app/${orgSlug}/agents`}>Clear</Link> : null}
          {dirty ? <button className="registry-apply-button" type="submit">Apply</button> : null}
        </div>
      ) : null}
    </form>
  );
}
