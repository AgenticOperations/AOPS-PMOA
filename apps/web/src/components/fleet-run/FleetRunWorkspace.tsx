'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { IconPlayerPlay, IconRefresh, IconSparkles } from '@tabler/icons-react';
import { refreshFleetRunAction, startFleetRunAction, type FleetRunActionState } from '@/app/actions/fleet-run';
import { FleetRunErrorPanel } from '@/components/fleet-run/FleetRunErrorPanel';
import type { FleetChecklistItem, FleetRunEvent, FleetRunRecord } from '@/lib/server/fleet-run-client';

type FleetRunWorkspaceProps = {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly canonicalGoal: string;
  readonly initialRuns: readonly FleetRunRecord[];
};

function explorerTx(chain: string, txHash: string): string {
  if (chain === 'base') return `https://sepolia.basescan.org/tx/${txHash}`;
  return `https://testnet.arcscan.app/tx/${txHash}`;
}

function statusTone(status: string): string {
  if (status === 'done' || status === 'completed') return 'is-done';
  if (status === 'running') return 'is-running';
  if (status === 'failed') return 'is-failed';
  return 'is-pending';
}

function Checklist({ items }: { readonly items: readonly FleetChecklistItem[] }) {
  return (
    <ol className="fleet-run-checklist">
      {items.map((item) => (
        <li className={statusTone(item.status)} key={item.id}>
          <span className="fleet-run-check-mark" aria-hidden="true" />
          <div>
            <strong>{item.label}</strong>
            <code>{item.tool}</code>
            <p>{item.goalClause}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function WirePanel({ run }: { readonly run: FleetRunRecord }) {
  const agents = Object.values(run.agents);
  return (
    <div className="fleet-run-wire">
      <h3>Live fleet</h3>
      <ul>
        {agents.map((agent) => (
          <li key={agent.agentId}>
            <span className="fleet-run-wire-name">{agent.name}</span>
            <span className="fleet-run-wire-chain">{agent.chain}</span>
            <code title={agent.endpointUrl}>{agent.endpointUrl.replace(/^https?:\/\//, '').slice(0, 36)}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventFeed({ events }: { readonly events: readonly FleetRunEvent[] }) {
  const visible = events.filter((event) => event.kind !== 'step_start');
  return (
    <div className="fleet-run-feed">
      {visible.map((event) => {
        const payload = event.payload;
        const text = typeof payload.text === 'string' ? payload.text : null;
        const brief = typeof payload.brief === 'string' ? payload.brief : null;
        const txHash = typeof payload.tx_hash === 'string' ? payload.tx_hash : null;
        const chain = typeof payload.chain === 'string' ? payload.chain : 'arc';
        const error = typeof payload.error === 'string' ? payload.error : null;
        return (
          <article className={`fleet-run-bubble fleet-run-bubble-${event.kind}`} key={event.id}>
            <header>
              <span>{event.kind}</span>
              {event.tool !== null ? <code>{event.tool}</code> : null}
            </header>
            {text !== null ? <pre className="fleet-run-md">{text}</pre> : null}
            {brief !== null ? <pre className="fleet-run-md">{brief}</pre> : null}
            {txHash !== null ? (
              <p>
                <a href={explorerTx(chain, txHash)} rel="noreferrer" target="_blank">
                  {chain} · {txHash.slice(0, 10)}…{txHash.slice(-6)}
                </a>
              </p>
            ) : null}
            {error !== null ? <p className="fleet-run-error">{error}</p> : null}
            {text === null && brief === null && txHash === null && error === null ? (
              <pre className="fleet-run-json">{JSON.stringify(payload, null, 2).slice(0, 600)}</pre>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

export function FleetRunWorkspace({
  orgId,
  orgSlug,
  canonicalGoal,
  initialRuns,
}: FleetRunWorkspaceProps) {
  const [run, setRun] = useState<FleetRunRecord | null>(initialRuns[0] ?? null);
  const [pending, startTransition] = useTransition();
  const [state, formAction, actionPending] = useActionState(
    startFleetRunAction.bind(null, orgId),
    {} as FleetRunActionState,
  );

  useEffect(() => {
    if (state.run !== undefined) setRun(state.run);
  }, [state.run]);

  const busy = pending || actionPending || run?.status === 'running';

  const doneCount = useMemo(
    () => run?.checklist.filter((item) => item.status === 'done').length ?? 0,
    [run],
  );

  function refresh() {
    if (run === null) return;
    startTransition(async () => {
      const next = await refreshFleetRunAction(orgId, run.id);
      if (next.run !== undefined) setRun(next.run);
    });
  }

  return (
    <div className="fleet-run-shell">
      <header className="fleet-run-hero">
        <div>
          <p className="fleet-run-eyebrow">AgentOps · Fleet Run</p>
          <h1>One goal. Guardrailed fleet.</h1>
          <p className="fleet-run-lede">
            Type a research goal. Orchestrator wires only live org agents, pays through real AgentOps tools,
            and returns the brief with on-chain receipts.
          </p>
        </div>
        <div className="fleet-run-hero-links">
          <Link href={`/app/${orgSlug}/payments/funding`}>Fund</Link>
          <Link href={`/app/${orgSlug}/controls`}>Policies</Link>
          <Link href={`/chat`}>Chat with agent</Link>
          <Link href={`/marketplace`}>Marketplace</Link>
        </div>
      </header>

      <div className="fleet-run-grid">
        <section className="fleet-run-main" aria-label="Fleet Run chat">
          <form action={formAction} className="fleet-run-composer">
            <label className="sr-only" htmlFor="fleet-run-goal">Goal</label>
            <textarea
              defaultValue={canonicalGoal}
              disabled={busy}
              id="fleet-run-goal"
              name="goal"
              placeholder="Describe the fleet outcome you want…"
              required
              rows={6}
            />
            <div className="fleet-run-composer-actions">
              <button className="fleet-run-primary" disabled={busy} type="submit">
                <IconPlayerPlay aria-hidden="true" size={16} stroke={1.8} />
                {busy ? 'Running under AgentOps…' : 'Run fleet'}
              </button>
              <button className="fleet-run-secondary" disabled={run === null || busy} onClick={refresh} type="button">
                <IconRefresh aria-hidden="true" size={16} stroke={1.8} />
                Refresh
              </button>
            </div>
            {state.error !== undefined ? (
              <FleetRunErrorPanel code={state.errorCode ?? null} message={state.error} orgSlug={orgSlug} />
            ) : null}
          </form>

          <div className="fleet-run-thread">
            {run === null ? (
              <div className="fleet-run-empty">
                <IconSparkles aria-hidden="true" size={22} stroke={1.6} />
                <p>No run yet. Use the canonical goal or write your own — specialists must be live on their endpoints.</p>
              </div>
            ) : (
              <>
                <div className="fleet-run-user-goal">
                  <span>You</span>
                  <pre>{run.goal}</pre>
                </div>
                <EventFeed events={run.events} />
                {run.status === 'failed' && run.error !== null ? (
                  <FleetRunErrorPanel message={run.error} orgSlug={orgSlug} />
                ) : null}
                {run.status === 'completed' && typeof run.fruit?.brief === 'string' ? (
                  <article className="fleet-run-fruit">
                    <h2>Final fruit</h2>
                    <pre className="fleet-run-md">{run.fruit.brief}</pre>
                  </article>
                ) : null}
              </>
            )}
          </div>
        </section>

        <aside className="fleet-run-side" aria-label="Run status">
          <div className="fleet-run-side-card">
            <div className="fleet-run-side-head">
              <h2>Goal checklist</h2>
              <span>
                {doneCount}/{run?.checklist.length ?? 0}
              </span>
            </div>
            {run !== null ? (
              <Checklist items={run.checklist} />
            ) : (
              <p className="fleet-run-muted">Checklist appears when a run starts.</p>
            )}
          </div>
          {run !== null ? (
            <div className="fleet-run-side-card">
              <WirePanel run={run} />
            </div>
          ) : null}
          <div className="fleet-run-side-card fleet-run-hints">
            <h3>AgentOps shown here</h3>
            <ul>
              <li><code>agentops.onboard</code></li>
              <li><code>agentops.payment_intra_fleet</code></li>
              <li>Second hop + Base hop</li>
              <li><code>agentops.activity_record</code></li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
