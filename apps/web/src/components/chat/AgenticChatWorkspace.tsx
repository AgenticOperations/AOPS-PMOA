'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { IconArrowUpRight } from '@tabler/icons-react';
import { agentChatTurnAction } from '@/app/actions/agent-chat';
import { FleetLiveGraph } from '@/components/chat/FleetLiveGraph';
import type {
  AgentChatTurn,
  ChatGraph,
  ChatHistoryMessage,
  ChatPendingState,
} from '@/lib/server/agent-chat-client';

type AgenticChatWorkspaceProps = {
  readonly orgId: string;
  readonly orgSlug: string;
};

const MAX_CHARS = 4000;

const SUGGESTIONS = [
  {
    id: 'what',
    title: 'What can AgentOps do?',
    detail: 'Product overview',
    message: 'What can AgentOps do, and how do MCP tools and the marketplace fit in?',
  },
  {
    id: 'marketplace',
    title: 'Recommend marketplace services',
    detail: 'Hire cards with prices',
    message: 'Recommend marketplace listings I should hire for research and payments.',
  },
  {
    id: 'create',
    title: 'Create 3 agents',
    detail: 'Confirm first',
    message: 'Create 3 agents for a research workflow.',
  },
  {
    id: 'fleet',
    title: 'Run Arc research fleet',
    detail: 'Nodes then payment edges',
    message: `Research brief: how agent-to-agent USDC payments work on Arc testnet.
Hire DataFetcher → Analyst (allow Analyst to buy more data) → Writer → SeniorReviewer on Base.
Respect each agent budget. Stay inside org policy.
Return a short brief plus payment receipts.`,
  },
] as const;

type ThreadItem = {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly links?: AgentChatTurn['links'];
  readonly confirms?: AgentChatTurn['confirms'];
  readonly listings?: AgentChatTurn['listings'];
  readonly graph?: ChatGraph | null;
};

function InlineLinks({
  links,
}: {
  readonly links: AgentChatTurn['links'] | undefined;
}) {
  if (links === undefined || links.length === 0) return null;
  return (
    <p className="achat-inline-links">
      {links.slice(0, 4).map((link, index) => (
        <span key={link.href}>
          {index > 0 ? ' · ' : null}
          <Link href={link.href}>{link.label}</Link>
        </span>
      ))}
    </p>
  );
}

function ListingCards({
  listings,
}: {
  readonly listings: AgentChatTurn['listings'] | undefined;
}) {
  if (listings === undefined || listings.length === 0) return null;
  return (
    <ul className="achat-listing-cards">
      {listings.map((listing) => (
        <li key={listing.id}>
          <Link className="achat-listing-card" href={listing.href}>
            <div className="achat-listing-card-top">
              <strong>{listing.name}</strong>
              <span className="achat-listing-price">{listing.priceHint}</span>
            </div>
            <p>{listing.summary}</p>
            <div className="achat-listing-card-meta">
              <span>{listing.category}</span>
              <span>{listing.chain}</span>
              <span className="achat-listing-open">Open →</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AgenticChatWorkspace({ orgId, orgSlug }: AgenticChatWorkspaceProps) {
  const [draft, setDraft] = useState('');
  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [pending, setPending] = useState<ChatPendingState | null>(null);
  const [graph, setGraph] = useState<ChatGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement | null>(null);
  const started = thread.length > 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [thread, graph, busy]);

  function historyFromThread(items: readonly ThreadItem[]): ChatHistoryMessage[] {
    return items.map((item) => ({ role: item.role, content: item.content }));
  }

  function applyTurn(userText: string, turn: AgentChatTurn, prior: readonly ThreadItem[]) {
    const next: ThreadItem[] = [
      ...prior,
      { id: `u-${Date.now()}`, role: 'user', content: userText },
      {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: turn.reply,
        links: turn.links,
        confirms: turn.confirms,
        listings: turn.listings,
        graph: turn.graph,
      },
    ];
    setThread(next);
    setPending(turn.pending);
    if (turn.graph !== null) setGraph(turn.graph);
  }

  function send(message: string, confirmId?: string | null) {
    const text = message.trim();
    if (text.length === 0 && (confirmId === undefined || confirmId === null)) return;
    setError(null);
    const prior = thread;
    const displayUser =
      confirmId !== undefined && confirmId !== null
        ? text.length > 0
          ? text
          : confirmId === 'create_agents'
            ? 'Yes — create the agents.'
            : confirmId === 'run_fleet'
              ? 'Run the fleet.'
              : 'Continue.'
        : text;

    startTransition(async () => {
      const result = await agentChatTurnAction(orgId, orgSlug, {
        message: text.length > 0 ? text : displayUser,
        history: historyFromThread(prior),
        pending,
        confirmId: confirmId ?? null,
      });
      if (result.error !== undefined || result.turn === undefined) {
        setError(result.error ?? 'Chat failed.');
        return;
      }
      applyTurn(displayUser, result.turn, prior);
      setDraft('');
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.trim().length === 0 || busy) return;
    send(draft);
  }

  function reset() {
    setThread([]);
    setPending(null);
    setGraph(null);
    setError(null);
    setDraft('');
  }

  return (
    <div className="achat-shell">
      {!started ? (
        <section className="achat-landing" aria-labelledby="achat-help-title">
          <h1 id="achat-help-title">
            How can I <em className="achat-script">help</em> you today?
          </h1>
          <p className="achat-lede">
            Ask about AgentOps, create agents, check funding, or run a multi-agent goal — with confirmations and a live
            fleet graph when you need one.
          </p>

          <form className="achat-composer" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="achat-goal">
              Message
            </label>
            <textarea
              disabled={busy}
              id="achat-goal"
              maxLength={MAX_CHARS}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message the agent…"
              rows={5}
              value={draft}
            />
            <div className="achat-composer-bar">
              <div className="achat-composer-meta">
                <span>
                  {draft.length}/{MAX_CHARS}
                </span>
                <Link href={`/app/${orgSlug}/overview`}>Console</Link>
              </div>
              <button className="achat-send" disabled={busy || draft.trim().length === 0} type="submit">
                <IconArrowUpRight aria-hidden="true" size={18} stroke={2} />
                <span className="sr-only">Send</span>
              </button>
            </div>
            {error !== null ? <p className="achat-error">{error}</p> : null}
          </form>

          <ul className="achat-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <li key={suggestion.id}>
                <button
                  disabled={busy}
                  onClick={() => {
                    setDraft(suggestion.message);
                    send(suggestion.message);
                  }}
                  type="button"
                >
                  <strong>{suggestion.title}</strong>
                  <span>{suggestion.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="achat-run achat-copilot">
          <header className="achat-run-header">
            <div>
              <p className="achat-eyebrow">AgentOps</p>
              <h2>Chat with agent</h2>
            </div>
            <div className="achat-run-actions">
              <button className="fleet-run-secondary" disabled={busy} onClick={reset} type="button">
                New chat
              </button>
              <Link className="achat-text-link" href={`/app/${orgSlug}/activity`}>
                Activity
              </Link>
              <Link className="achat-text-link" href="/marketplace">
                Marketplace
              </Link>
            </div>
          </header>

          <div className="achat-copilot-layout">
            <section className="achat-copilot-thread" aria-label="Chat thread">
              {thread.map((item, index) => {
                const isLast = index === thread.length - 1;
                return (
                <article
                  className={item.role === 'user' ? 'achat-msg achat-msg-user' : 'achat-msg achat-msg-agent'}
                  key={item.id}
                >
                  <span className="achat-msg-label">{item.role === 'user' ? 'You' : 'Agent'}</span>
                  <p className="achat-msg-body">{item.content}</p>
                  {item.role === 'assistant' ? <ListingCards listings={item.listings} /> : null}
                  {item.role === 'assistant' ? <InlineLinks links={item.links} /> : null}
                  {item.role === 'assistant' &&
                  isLast &&
                  item.confirms !== undefined &&
                  item.confirms.length > 0 ? (
                    <div className="achat-confirms">
                      {item.confirms.map((confirm) => (
                        <button
                          className="achat-confirm"
                          disabled={busy}
                          key={confirm.id}
                          onClick={() => send(confirm.label, confirm.id)}
                          type="button"
                        >
                          {confirm.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
                );
              })}
              {busy ? <p className="achat-running">Working…</p> : null}
              {error !== null ? <p className="achat-error">{error}</p> : null}
              <div ref={endRef} />
            </section>

            <aside className="achat-copilot-side" aria-label="Live fleet graph">
              {graph !== null ? (
                <div className="achat-side-card">
                  <h3>Fleet graph</h3>
                  <p className="achat-side-hint">Nodes first, then payment edges as the run settles.</p>
                  <FleetLiveGraph graph={graph} />
                </div>
              ) : (
                <div className="achat-side-card">
                  <h3>Co-pilot</h3>
                  <ul className="achat-side-list">
                    <li>Ask product / MCP questions</li>
                    <li>Create any number of agents</li>
                    <li>Policies → Fund → Run</li>
                  </ul>
                </div>
              )}
            </aside>
          </div>

          <form className="achat-composer achat-composer-dock" onSubmit={onSubmit}>
            <label className="sr-only" htmlFor="achat-followup">
              Follow-up
            </label>
            <textarea
              disabled={busy}
              id="achat-followup"
              maxLength={MAX_CHARS}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask a follow-up…"
              rows={2}
              value={draft}
            />
            <div className="achat-composer-bar">
              <div className="achat-composer-meta">
                <span>
                  {draft.length}/{MAX_CHARS}
                </span>
              </div>
              <button className="achat-send" disabled={busy || draft.trim().length === 0} type="submit">
                <IconArrowUpRight aria-hidden="true" size={18} stroke={2} />
                <span className="sr-only">Send</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
