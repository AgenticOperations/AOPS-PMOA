'use client';

import { useActionState, useMemo, useState } from 'react';
import { IconArrowRight, IconSearch } from '@tabler/icons-react';
import type { MemberRecord, Role, TeamRecord } from '@/lib/identity-spine-types';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTablePager } from '@/components/ui/data-table-pager';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import { formatUtcDateTime } from '@/lib/date-format';

type FormAction = (formData: FormData) => Promise<void>;
type ActionState = { readonly error?: string };
const pageSize = 10;

function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function initials(name: string): string {
  return name.split(/\s+/g).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

export function SettingsMemberTable({ activeOwnerCount, members, removeAction, roles, updateAction }: {
  readonly activeOwnerCount: number;
  readonly members: readonly MemberRecord[];
  readonly removeAction: FormAction;
  readonly roles: readonly Role[];
  readonly updateAction: FormAction;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [page, setPage] = useState(1);
  const selected = useMemo(() => members.find((member) => member.id === selectedId) ?? null, [members, selectedId]);
  const soleOwner = selected?.role === 'owner' && activeOwnerCount === 1;
  const filtered = members.filter((member) => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length > 0 && !`${member.name} ${member.email} ${member.id}`.toLowerCase().includes(normalized)) return false;
    return roleFilter === 'all' || member.role === roleFilter;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const [updateState, updateFormAction, updatePending] = useActionState(async (_state: ActionState, formData: FormData) => {
    try { await updateAction(formData); setSelectedId(null); return {}; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Member role could not be updated.' }; }
  }, {});
  const [removeState, removeFormAction, removePending] = useActionState(async (_state: ActionState, formData: FormData) => {
    try { await removeAction(formData); setSelectedId(null); setConfirmRemove(false); return {}; }
    catch (error) { return { error: error instanceof Error ? error.message : 'Member could not be removed.' }; }
  }, {});
  const busy = updatePending || removePending;
  const close = () => { if (!busy) { setSelectedId(null); setConfirmRemove(false); } };

  return (
    <section aria-labelledby="members-title" className="settings-table-section">
      <div className="settings-table-toolbar"><label className="settings-search-field"><IconSearch aria-hidden="true" size={15} stroke={1.8} /><span className="sr-only">Search members</span><input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search member or email…" value={query} /></label><label><span className="sr-only">Member role</span><select onChange={(event) => { setRoleFilter(event.target.value as 'all' | Role); setPage(1); }} value={roleFilter}><option value="all">All roles</option>{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label></div>
      <div className="settings-section-heading"><div><h2 id="members-title">Workspace members</h2><p>Roles govern policy authoring, payment operations, approvals, and evidence access.</p></div><span>{filtered.length} of {members.length}</span></div>
      {members.length === 0 ? <div className="settings-empty-state"><strong>No active members</strong><p>Add the first operator by email.</p></div> : <><TableShell className="settings-table-shell"><Table aria-label="Workspace members" className="settings-table"><TableHeader><TableRow><TableHead>Member</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Joined</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody>{visible.map((member) => <TableRow key={member.id}><TableCell><div className="settings-primary-cell"><span>{initials(member.name)}</span><div><strong>{member.name}</strong><small>{member.email}</small></div></div></TableCell><TableCell>{roleLabel(member.role)}</TableCell><TableCell><StatusBadge status={member.status} /></TableCell><TableCell>{member.joined_at === null ? <span>Not recorded</span> : <time dateTime={member.joined_at}>{formatUtcDateTime(member.joined_at)}</time>}</TableCell><TableCell><button aria-label={`Open member ${member.name}`} className="table-row-action" onClick={() => setSelectedId(member.id)} type="button"><IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></button></TableCell></TableRow>)}</TableBody></Table></TableShell><DataTablePager itemLabel="members" onPageChange={setPage} page={safePage} pageSize={pageSize} total={filtered.length} /></>}

      <Sheet labelledBy="member-detail-title" onOpenChange={(open) => !open && close()} open={selected !== null} panelClassName="settings-drawer">
        {selected === null ? null : <><SheetHeader><div><SheetTitle id="member-detail-title">{selected.name}</SheetTitle><SheetDescription>{selected.email}</SheetDescription></div><SheetCloseButton disabled={busy} onClick={close} /></SheetHeader><SheetBody className="settings-drawer-form"><div className="settings-drawer-status"><StatusBadge status={selected.status} /><code>{selected.id}</code></div><form action={updateFormAction} className="settings-inline-form"><input name="memberId" type="hidden" value={selected.id} /><label><span>Role</span><select defaultValue={selected.role} key={`${selected.id}:${selected.role}`} name="role" disabled={soleOwner}>{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label>{soleOwner ? <p className="settings-form-note">This is the workspace&apos;s only owner. Promote another owner before changing this role.</p> : null}{updateState.error !== undefined ? <p className="form-error" role="alert">{updateState.error}</p> : null}<button className="settings-button settings-button-primary settings-form-submit" disabled={soleOwner || updatePending} type="submit">{updatePending ? 'Saving…' : 'Save role'}</button></form>{soleOwner ? <div className="settings-protected-state"><strong>Sole owner</strong><p>This member cannot be removed while they are the only active owner.</p></div> : confirmRemove ? <form action={removeFormAction} className="settings-destructive-confirm"><input name="memberId" type="hidden" value={selected.id} /><div><strong>Remove workspace access?</strong><p>This action removes the member from the organization but preserves historical evidence.</p></div>{removeState.error !== undefined ? <p className="form-error" role="alert">{removeState.error}</p> : null}<div><button className="button-secondary" onClick={() => setConfirmRemove(false)} type="button">Cancel removal</button><button className="button-danger" disabled={removePending} type="submit">{removePending ? 'Removing…' : 'Confirm remove'}</button></div></form> : <button className="button-danger settings-destructive-trigger" onClick={() => setConfirmRemove(true)} type="button">Remove member</button>}</SheetBody></>}
      </Sheet>
    </section>
  );
}

export function SettingsTeamTable({ archiveAction, teams, updateAction }: { readonly archiveAction: FormAction; readonly teams: readonly TeamRecord[]; readonly updateAction: FormAction }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'active' | 'archived'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'default' | 'custom'>('all');
  const [page, setPage] = useState(1);
  const selected = useMemo(() => teams.find((team) => team.id === selectedId) ?? null, [selectedId, teams]);
  const filtered = teams.filter((team) => {
    if (query.trim().length > 0 && !`${team.name} ${team.description} ${team.id}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (stateFilter === 'active' && team.archived_at !== null) return false;
    if (stateFilter === 'archived' && team.archived_at === null) return false;
    if (typeFilter === 'default' && !team.is_default) return false;
    if (typeFilter === 'custom' && team.is_default) return false;
    return true;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const [updateState, updateFormAction, updatePending] = useActionState(async (_state: ActionState, formData: FormData) => { try { await updateAction(formData); setSelectedId(null); return {}; } catch (error) { return { error: error instanceof Error ? error.message : 'Team could not be updated.' }; } }, {});
  const [archiveState, archiveFormAction, archivePending] = useActionState(async (_state: ActionState, formData: FormData) => { try { await archiveAction(formData); setSelectedId(null); setConfirmArchive(false); return {}; } catch (error) { return { error: error instanceof Error ? error.message : 'Team could not be archived.' }; } }, {});
  const busy = updatePending || archivePending;
  const close = () => { if (!busy) { setSelectedId(null); setConfirmArchive(false); } };

  return (
    <section aria-labelledby="teams-title" className="settings-table-section">
      <div className="settings-table-toolbar"><label className="settings-search-field"><IconSearch aria-hidden="true" size={15} stroke={1.8} /><span className="sr-only">Search teams</span><input onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search teams…" value={query} /></label><label><span className="sr-only">Team type</span><select onChange={(event) => { setTypeFilter(event.target.value as 'all' | 'default' | 'custom'); setPage(1); }} value={typeFilter}><option value="all">All types</option><option value="default">Default</option><option value="custom">Custom</option></select></label><label><span className="sr-only">Team state</span><select onChange={(event) => { setStateFilter(event.target.value as 'all' | 'active' | 'archived'); setPage(1); }} value={stateFilter}><option value="all">All states</option><option value="active">Active</option><option value="archived">Archived</option></select></label></div>
      <div className="settings-section-heading"><div><h2 id="teams-title">Workspace teams</h2><p>Teams form a real scope for policy bindings and operational limits.</p></div><span>{filtered.length} of {teams.length}</span></div>
      {teams.length === 0 ? <div className="settings-empty-state"><strong>No teams</strong><p>Create a team to scope agents.</p></div> : <><TableShell className="settings-table-shell"><Table aria-label="Workspace teams" className="settings-table"><TableHeader><TableRow><TableHead>Team</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader><TableBody>{visible.map((team) => <TableRow key={team.id}><TableCell><div className="settings-primary-cell"><span>TM</span><div><strong>{team.name}</strong><small>{team.description || 'No description'}</small></div></div></TableCell><TableCell>{team.is_default ? 'Default' : 'Custom'}</TableCell><TableCell><StatusBadge status={team.archived_at === null ? 'active' : 'archived'} /></TableCell><TableCell><time dateTime={team.updated_at}>{formatUtcDateTime(team.updated_at)}</time></TableCell><TableCell><button aria-label={`Open team ${team.name}`} className="table-row-action" onClick={() => setSelectedId(team.id)} type="button"><IconArrowRight aria-hidden="true" size={13} stroke={1.8} /></button></TableCell></TableRow>)}</TableBody></Table></TableShell><DataTablePager itemLabel="teams" onPageChange={setPage} page={safePage} pageSize={pageSize} total={filtered.length} /></>}

      <Sheet labelledBy="team-detail-title" onOpenChange={(open) => !open && close()} open={selected !== null} panelClassName="settings-drawer">
        {selected === null ? null : <><SheetHeader><div><SheetTitle id="team-detail-title">{selected.name}</SheetTitle><SheetDescription>{selected.is_default ? 'Default workspace team' : 'Custom policy and operations scope'}</SheetDescription></div><SheetCloseButton disabled={busy} onClick={close} /></SheetHeader><SheetBody className="settings-drawer-form"><div className="settings-drawer-status"><StatusBadge status={selected.archived_at === null ? 'active' : 'archived'} /><code>{selected.id}</code></div>{selected.archived_at !== null ? <div className="settings-protected-state"><strong>Archived team</strong><p>This team remains available as historical scope evidence and cannot be edited.</p></div> : <><form action={updateFormAction} className="settings-inline-form"><input name="teamId" type="hidden" value={selected.id} /><label><span>Name</span><input defaultValue={selected.name} name="name" required /></label><label><span>Description</span><textarea defaultValue={selected.description} name="description" rows={4} /></label>{updateState.error !== undefined ? <p className="form-error" role="alert">{updateState.error}</p> : null}<button className="settings-button settings-button-primary settings-form-submit" disabled={updatePending} type="submit">{updatePending ? 'Saving…' : 'Save team'}</button></form>{selected.is_default ? <p className="settings-form-note">The default team cannot be archived.</p> : confirmArchive ? <form action={archiveFormAction} className="settings-destructive-confirm"><input name="teamId" type="hidden" value={selected.id} /><div><strong>Archive this team?</strong><p>Historical references remain, but the team stops accepting active assignments.</p></div>{archiveState.error !== undefined ? <p className="form-error" role="alert">{archiveState.error}</p> : null}<div><button className="button-secondary" onClick={() => setConfirmArchive(false)} type="button">Cancel archive</button><button className="button-danger" disabled={archivePending} type="submit">{archivePending ? 'Archiving…' : 'Confirm archive'}</button></div></form> : <button className="button-danger settings-destructive-trigger" onClick={() => setConfirmArchive(true)} type="button">Archive team</button>}</>}</SheetBody></>}
      </Sheet>
    </section>
  );
}
