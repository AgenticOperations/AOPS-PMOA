'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AgentRosterItem } from '@/lib/identity-spine-types';

type ChecklistItem = {
  readonly done: boolean;
  readonly href: string;
  readonly label: string;
  readonly detail: string;
};

type HomeConnectGuideProps = {
  readonly agents: readonly AgentRosterItem[];
  readonly checklist: readonly ChecklistItem[];
  readonly mcpEndpoint: string;
  readonly orgSlug: string;
};

type ClientTab = 'claude' | 'cursor' | 'codex';

function CopyButton({ label, value }: { readonly label: string; readonly value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="home-connect-copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          setCopied(false);
        }
      }}
      type="button"
    >
      {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * Compact MCP connect strip for Home — endpoint + checklist always visible;
 * client configs stay behind a single toggle so the page stays scannable.
 */
export function HomeConnectGuide({ agents, checklist, mcpEndpoint, orgSlug }: HomeConnectGuideProps) {
  const incomplete = checklist.some((item) => !item.done);
  const [open, setOpen] = useState(incomplete);
  const [tab, setTab] = useState<ClientTab>('claude');
  const firstAgent = agents.find((agent) => agent.status === 'active') ?? agents[0];
  const agentLabel = firstAgent?.name ?? 'your agent';
  const credentialPlaceholder = '<paste-credential-from-Agents>';

  const snippets = useMemo(() => {
    const claudeConfig = JSON.stringify(
      {
        mcpServers: {
          agentops: {
            type: 'http',
            url: mcpEndpoint,
            headers: { Authorization: 'Bearer ${AGENTOPS_MCP_CREDENTIAL}' },
          },
        },
      },
      null,
      2,
    );
    const cursorConfig = JSON.stringify(
      {
        mcpServers: {
          agentops: {
            url: mcpEndpoint,
            headers: { Authorization: `Bearer ${credentialPlaceholder}` },
          },
        },
      },
      null,
      2,
    );
    const codexCommand = `codex mcp add agentops --url ${mcpEndpoint} --bearer-token-env-var AGENTOPS_MCP_CREDENTIAL`;
    const starterPrompt = `Connect to AgentOps MCP at ${mcpEndpoint} with Bearer ${credentialPlaceholder}.
Call agentops.onboard, then use agentops.operation_check / agentops.payment_x402 for governed actions.
Issue the credential from Agents → ${agentLabel} → Connections.`;

    return { claudeConfig, cursorConfig, codexCommand, starterPrompt };
  }, [agentLabel, credentialPlaceholder, mcpEndpoint]);

  const activeSnippet = tab === 'claude'
    ? snippets.claudeConfig
    : tab === 'cursor'
      ? snippets.cursorConfig
      : snippets.codexCommand;

  return (
    <section aria-labelledby="home-connect-title" className="home-connect" data-tour="home-connect">
      <div className="home-connect-bar">
        <div className="home-connect-bar-lead">
          <span aria-hidden="true" className="home-connect-info-mark">i</span>
          <div>
            <h2 id="home-connect-title">Connect via MCP</h2>
            <p>Agents reach AgentOps through MCP tools — not a payment SDK.</p>
          </div>
        </div>
        <div className="home-connect-bar-actions">
          <code title={mcpEndpoint}>{mcpEndpoint}</code>
          <CopyButton label="Copy URL" value={mcpEndpoint} />
          <button
            aria-expanded={open}
            className="home-connect-toggle"
            onClick={() => setOpen((value) => !value)}
            type="button"
          >
            {open ? 'Hide setup' : 'Client setup'}
          </button>
        </div>
      </div>

      <ol className="home-connect-steps" aria-label="Setup checklist">
        {checklist.map((item) => (
          <li className={item.done ? 'is-done' : undefined} key={item.label}>
            <span aria-hidden="true">{item.done ? '✓' : '○'}</span>
            <Link href={item.href} title={item.detail}>{item.label}</Link>
          </li>
        ))}
      </ol>

      {open ? (
        <div className="home-connect-drawer">
          <div className="home-connect-tabs" role="tablist" aria-label="Client setup">
            {([
              ['claude', 'Claude Code'],
              ['cursor', 'Cursor'],
              ['codex', 'Codex CLI'],
            ] as const).map(([id, label]) => (
              <button
                aria-selected={tab === id}
                className={tab === id ? 'is-active' : undefined}
                key={id}
                onClick={() => setTab(id)}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="home-connect-snippet">
            <CopyButton
              label={tab === 'codex' ? 'Copy command' : 'Copy config'}
              value={activeSnippet}
            />
            <pre>{activeSnippet}</pre>
          </div>
          <div className="home-connect-drawer-foot">
            <p>
              Credential lives under{' '}
              <Link href={`/app/${orgSlug}/agents`}>Agents</Link>
              {' · '}
              <CopyButton label="Copy starter prompt" value={snippets.starterPrompt} />
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
