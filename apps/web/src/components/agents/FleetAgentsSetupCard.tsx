'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { ensureFleetAgentsAction, type EnsureFleetAgentsState } from '@/app/actions/fleet-setup';

type FleetAgentsSetupCardProps = {
  readonly orgId: string;
  readonly orgSlug: string;
};

/** Lives on Agents (?setup=fleet) — keeps Fleet Chat free of setup chrome. */
export function FleetAgentsSetupCard({ orgId, orgSlug }: FleetAgentsSetupCardProps) {
  const [state, formAction, pending] = useActionState(
    ensureFleetAgentsAction.bind(null, orgId, orgSlug),
    {} as EnsureFleetAgentsState,
  );

  return (
    <aside className="fleet-agents-setup" role="status">
      <div>
        <p className="fleet-setup-eyebrow">Chat with agent setup</p>
        <h2>Create the five fleet agents</h2>
        <p>
          Exact names: Orchestrator, DataFetcher, Analyst, Writer, SeniorReviewer. This also enables payment access;
          wait for wallets, then return to chat.
        </p>
        {state.message !== undefined ? <p className="fleet-setup-ok">{state.message}</p> : null}
        {state.error !== undefined ? (
          <p className="fleet-run-error" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
      <div className="fleet-agents-setup-actions">
        <form action={formAction}>
          <button className="fleet-run-primary" disabled={pending} type="submit">
            {pending ? 'Creating…' : 'Create / empower fleet agents'}
          </button>
        </form>
        <Link className="fleet-run-secondary" href="/chat">
          Back to chat
        </Link>
      </div>
    </aside>
  );
}
