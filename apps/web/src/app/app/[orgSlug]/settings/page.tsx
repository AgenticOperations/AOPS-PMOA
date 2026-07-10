import { redirect } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import {
  addMemberAction,
  archiveTeamAction,
  createTeamAction,
  removeMemberAction,
  skipOnboardingStepAction,
  updateMemberRoleAction,
  updateTeamAction,
} from '@/app/actions/workspace';
import { getOrgBySlug, listMembers, listOnboardingStates, listTeams } from '@/lib/server/identity-spine-client';
import type { Role } from '@/lib/identity-spine-types';

export const dynamic = 'force-dynamic';

type SettingsPageProps = {
  readonly params: Promise<{ readonly orgSlug: string }>;
  readonly searchParams?: Promise<Record<string, string | readonly string[] | undefined>>;
};

const ROLE_OPTIONS: readonly Role[] = ['owner', 'admin', 'operator', 'auditor', 'viewer', 'member'];
const SETTINGS_TABS = ['members', 'teams', 'profile'] as const;
const ONBOARDING_STEPS = [
  { key: 'circle_wallet_sync', label: 'Sync Circle Agent Wallet' },
  { key: 'treasury_funding', label: 'Fund testnet treasury' },
  { key: 'agent_setup', label: 'Create agent and credential' },
  { key: 'policy_setup', label: 'Attach first policy' },
  { key: 'payment_access', label: 'Enable agent payment access' },
  { key: 'runtime_test', label: 'Run API or MCP test' },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];

function singleParam(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  return value?.[0] ?? '';
}

function normalizeTab(value: string): SettingsTab {
  return SETTINGS_TABS.includes(value as SettingsTab) ? (value as SettingsTab) : 'members';
}

function formatRole(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function settingsTabHref(orgSlug: string, tab: SettingsTab): string {
  return tab === 'members' ? `/app/${orgSlug}/settings` : `/app/${orgSlug}/settings?tab=${tab}`;
}

export default async function SettingsPage({ params, searchParams }: SettingsPageProps) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};
  const activeTab = normalizeTab(singleParam(query.tab));
  let org;
  try {
    org = await getOrgBySlug(orgSlug);
  } catch {
    redirect('/auth');
  }

  const [members, teams, onboardingStates] = await Promise.all([
    listMembers(org.id),
    listTeams(org.id),
    listOnboardingStates(org.id),
  ]);
  const onboardingByKey = new Map(onboardingStates.map((state) => [state.flow_key, state]));
  const activeMembers = members.filter((member) => member.status !== 'removed');
  const activeTeams = teams.filter((team) => team.archived_at === null);

  return (
    <ConsoleShell active="settings" org={org}>
      <div className="settings-console">
        <PageHeader
          description="Manage access, teams, and optional setup progress for this organisation."
          title="Settings"
        />

        <nav aria-label="Settings sections" className="settings-tabs">
          {[
            { key: 'members' as const, label: 'Members' },
            { key: 'teams' as const, label: 'Teams' },
            { key: 'profile' as const, label: 'Profile & setup' },
          ].map((tab) => (
            <a
              aria-current={activeTab === tab.key ? 'page' : undefined}
              className={activeTab === tab.key ? 'is-active' : ''}
              href={settingsTabHref(org.slug, tab.key)}
              key={tab.key}
            >
              {tab.label}
            </a>
          ))}
        </nav>

        {activeTab === 'members' ? (
          <div className="settings-grid">
            <Card aria-labelledby="members-title">
              <CardHeader>
                <div className="settings-card-heading">
                  <div>
                    <CardTitle id="members-title">Members</CardTitle>
                    <CardDescription>
                      Workspace roles control policy authoring, payment operations, and approval decisions.
                    </CardDescription>
                  </div>
                  <Badge variant="outline">{activeMembers.length} active</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {activeMembers.length === 0 ? (
                  <EmptyState
                    description="Add the first operator by email."
                    title="No active members"
                    variant="settings"
                  />
                ) : (
                  <TableShell>
                    <Table aria-label="Workspace members">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Member</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {activeMembers.map((member) => (
                          <TableRow key={member.id}>
                            <TableCell>
                              <div className="settings-primary-cell">
                                <strong>{member.name}</strong>
                                <span>{member.email}</span>
                              </div>
                            </TableCell>
                            <TableCell>{formatRole(member.role)}</TableCell>
                            <TableCell>
                              <StatusBadge status={member.status} />
                            </TableCell>
                            <TableCell>
                              <div className="settings-row-actions">
                                <form action={updateMemberRoleAction.bind(null, org.id, org.slug)} className="settings-inline-form">
                                  <input name="memberId" type="hidden" value={member.id} />
                                  <select defaultValue={member.role} name="role" aria-label={`Role for ${member.email}`}>
                                    {ROLE_OPTIONS.map((role) => (
                                      <option key={role} value={role}>{formatRole(role)}</option>
                                    ))}
                                  </select>
                                  <button className="button-secondary" type="submit">Save</button>
                                </form>
                                <form action={removeMemberAction.bind(null, org.id, org.slug)}>
                                  <input name="memberId" type="hidden" value={member.id} />
                                  <button className="button-secondary" type="submit">Remove</button>
                                </form>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableShell>
                )}
              </CardContent>
            </Card>

            <aside className="settings-action-stack" aria-label="Member actions">
              <Card>
                <CardHeader>
                  <CardTitle>Add member</CardTitle>
                  <CardDescription>Add an existing or new user by email.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form action={addMemberAction.bind(null, org.id, org.slug)} className="operations-form">
                    <label>
                      <span>Email</span>
                      <input name="email" required type="email" />
                    </label>
                    <label>
                      <span>Name</span>
                      <input name="name" />
                    </label>
                    <label>
                      <span>Role</span>
                      <select defaultValue="viewer" name="role">
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>{formatRole(role)}</option>
                        ))}
                      </select>
                    </label>
                    <button className="button-primary" type="submit">Add member</button>
                  </form>
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : null}

        {activeTab === 'teams' ? (
          <div className="settings-grid">
            <Card aria-labelledby="teams-title">
              <CardHeader>
                <div className="settings-card-heading">
                  <div>
                    <CardTitle id="teams-title">Teams</CardTitle>
                    <CardDescription>Teams group agents for scoped policy binding and operational limits.</CardDescription>
                  </div>
                  <Badge variant="outline">{activeTeams.length} active</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {teams.length === 0 ? (
                  <EmptyState description="Create a team to scope agents." title="No teams" variant="settings" />
                ) : (
                  <TableShell>
                    <Table aria-label="Workspace teams">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Team</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teams.map((team) => (
                          <TableRow key={team.id}>
                            <TableCell>
                              <div className="settings-primary-cell">
                                <strong>{team.name}</strong>
                                <span>{team.description || 'No description'}</span>
                              </div>
                            </TableCell>
                            <TableCell>{team.is_default ? 'Default' : 'Custom'}</TableCell>
                            <TableCell>
                              <StatusBadge status={team.archived_at === null ? 'active' : 'archived'} />
                            </TableCell>
                            <TableCell>
                              <div className="settings-row-actions">
                                <form action={updateTeamAction.bind(null, org.id, org.slug)} className="settings-inline-form settings-team-form">
                                  <input name="teamId" type="hidden" value={team.id} />
                                  <input aria-label={`Name for ${team.name}`} defaultValue={team.name} name="name" required />
                                  <input aria-label={`Description for ${team.name}`} defaultValue={team.description} name="description" />
                                  <button className="button-secondary" disabled={team.archived_at !== null} type="submit">Save</button>
                                </form>
                                <form action={archiveTeamAction.bind(null, org.id, org.slug)}>
                                  <input name="teamId" type="hidden" value={team.id} />
                                  <button className="button-secondary" disabled={team.is_default || team.archived_at !== null} type="submit">Archive</button>
                                </form>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableShell>
                )}
              </CardContent>
            </Card>

            <aside className="settings-action-stack" aria-label="Team actions">
              <Card>
                <CardHeader>
                  <CardTitle>Create team</CardTitle>
                  <CardDescription>Create a policy and operations scope for agents.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form action={createTeamAction.bind(null, org.id, org.slug)} className="operations-form">
                    <label>
                      <span>Name</span>
                      <input name="name" required />
                    </label>
                    <label>
                      <span>Description</span>
                      <textarea name="description" rows={3} />
                    </label>
                    <button className="button-primary" type="submit">Create team</button>
                  </form>
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : null}

        {activeTab === 'profile' ? (
          <div className="settings-grid">
            <Card aria-labelledby="profile-title">
              <CardHeader>
                <CardTitle id="profile-title">Workspace profile</CardTitle>
                <CardDescription>Read-only workspace identity currently used across API, MCP, and audit surfaces.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="settings-profile-grid">
                  <div>
                    <dt>Name</dt>
                    <dd>{org.name}</dd>
                  </div>
                  <div>
                    <dt>Slug</dt>
                    <dd>{org.slug}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd><StatusBadge status={org.status} /></dd>
                  </div>
                  <div>
                    <dt>Default team</dt>
                    <dd>{org.default_team_id}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card aria-labelledby="onboarding-title">
              <CardHeader>
                <CardTitle id="onboarding-title">Setup checklist</CardTitle>
                <CardDescription>Every step after creating the workspace is optional and can be completed later.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="settings-setup-list" aria-label="Onboarding setup steps">
                  {ONBOARDING_STEPS.map((step) => {
                    const state = onboardingByKey.get(step.key);
                    const status = state?.status ?? 'not_started';
                    return (
                      <article className="settings-setup-row" key={step.key}>
                        <div>
                          <strong>{step.label}</strong>
                          <span>{status.replace('_', ' ')}</span>
                        </div>
                        <form action={skipOnboardingStepAction.bind(null, org.id, org.slug)}>
                          <input name="flowKey" type="hidden" value={step.key} />
                          <button className="button-secondary" disabled={status === 'completed'} type="submit">Skip</button>
                        </form>
                      </article>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>
    </ConsoleShell>
  );
}
