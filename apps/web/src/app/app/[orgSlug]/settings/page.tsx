import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SettingsCreateDrawer } from '@/components/settings/SettingsCreateDrawer';
import { SettingsMemberTable, SettingsTeamTable } from '@/components/settings/SettingsEntityTables';
import { StatusBadge } from '@/components/ui/status-badge';
import { addMemberAction, archiveTeamAction, createTeamAction, removeMemberAction, skipOnboardingStepAction, updateMemberRoleAction, updateTeamAction } from '@/app/actions/workspace';
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
  { key: 'circle_wallet_sync', label: 'Circle wallet sync' },
  { key: 'treasury_funding', label: 'Treasury funding' },
  { key: 'agent_setup', label: 'Agent and credential' },
  { key: 'policy_setup', label: 'Starter policy' },
  { key: 'payment_access', label: 'Payment access' },
  { key: 'runtime_test', label: 'Runtime test' },
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];

function singleParam(value: string | readonly string[] | undefined): string {
  if (typeof value === 'string') return value;
  return value?.[0] ?? '';
}

function normalizeTab(value: string): SettingsTab {
  return SETTINGS_TABS.includes(value as SettingsTab) ? value as SettingsTab : 'members';
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

  const [members, teams, onboardingStates] = await Promise.all([listMembers(org.id), listTeams(org.id), listOnboardingStates(org.id)]);
  const onboardingByKey = new Map(onboardingStates.map((state) => [state.flow_key, state]));
  const activeMembers = members.filter((member) => member.status !== 'removed');
  const activeOwnerCount = activeMembers.filter((member) => member.role === 'owner').length;
  const resolvedSteps = ONBOARDING_STEPS.filter((step) => onboardingByKey.get(step.key)?.status === 'completed').length;
  const header = activeTab === 'members'
    ? { title: 'Members', description: 'Manage who can operate this workspace and which role governs access.', action: <SettingsCreateDrawer action={addMemberAction.bind(null, org.id, org.slug)} mode="member" roles={ROLE_OPTIONS} /> }
    : activeTab === 'teams'
      ? { title: 'Teams', description: 'Group agents for scoped policy binding and operational limits.', action: <SettingsCreateDrawer action={createTeamAction.bind(null, org.id, org.slug)} mode="team" /> }
      : { title: 'Profile & setup', description: 'Workspace identity and optional activation progress backed by the current organization record.', action: null };

  return (
      <div className="settings-workbench">
        <nav aria-label="Settings sections" className="settings-subnav">
          {[{ key: 'members' as const, label: 'Members' }, { key: 'teams' as const, label: 'Teams' }, { key: 'profile' as const, label: 'Profile & setup' }].map((tab) => <Link aria-current={activeTab === tab.key ? 'page' : undefined} className={activeTab === tab.key ? 'is-active' : undefined} href={settingsTabHref(org.slug, tab.key)} key={tab.key}>{tab.label}</Link>)}
        </nav>

        <header className="settings-page-header">
          <div><p className="settings-eyebrow">Organization / settings</p><h1>{header.title}</h1><p>{header.description}</p></div>
          {header.action === null ? null : <div className="settings-header-actions">{header.action}</div>}
        </header>

        {activeTab === 'members' ? (
          <SettingsMemberTable activeOwnerCount={activeOwnerCount} members={activeMembers} removeAction={removeMemberAction.bind(null, org.id, org.slug)} roles={ROLE_OPTIONS} updateAction={updateMemberRoleAction.bind(null, org.id, org.slug)} />
        ) : null}

        {activeTab === 'teams' ? (
          <SettingsTeamTable archiveAction={archiveTeamAction.bind(null, org.id, org.slug)} teams={teams} updateAction={updateTeamAction.bind(null, org.id, org.slug)} />
        ) : null}

        {activeTab === 'profile' ? (
          <div className="settings-profile-layout">
            <section>
              <div className="settings-section-heading"><div><h2>Workspace profile</h2><p>Canonical identity used across API, MCP, policy, and evidence surfaces.</p></div></div>
              <dl className="settings-definition-list">
                <div><dt>Name</dt><dd>{org.name}</dd></div>
                <div><dt>Slug</dt><dd><code>{org.slug}</code></dd></div>
                <div><dt>Workspace status</dt><dd><StatusBadge status={org.status} /></dd></div>
                <div><dt>Default team</dt><dd><code>{org.default_team_id}</code></dd></div>
              </dl>
            </section>
            <section>
              <div className="settings-section-heading"><div><h2>Setup progress</h2><p>Optional steps that never gate entry into the console.</p></div><span>{resolvedSteps} of {ONBOARDING_STEPS.length}</span></div>
              <div className="settings-setup-list" aria-label="Onboarding setup steps">
                {ONBOARDING_STEPS.map((step) => {
                  const state = onboardingByKey.get(step.key);
                  const status = state?.status ?? 'not_started';
                  const skipped = state?.payload.skipped === true;
                  const displayStatus = skipped ? 'skipped' : status.replaceAll('_', ' ');
                  const resolved = status === 'completed';
                  return <article className="settings-setup-row" key={step.key}><div><strong>{step.label}</strong><span>{displayStatus}</span></div><StatusBadge label={displayStatus} status={skipped ? 'inactive' : status} />{resolved ? null : <form action={skipOnboardingStepAction.bind(null, org.id, org.slug)}><input name="flowKey" type="hidden" value={step.key} /><button className="settings-text-action" type="submit">Skip for now</button></form>}</article>;
                })}
              </div>
            </section>
          </div>
        ) : null}
      </div>
  );
}
