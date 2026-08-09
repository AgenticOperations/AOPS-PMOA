'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type ChecklistItem = {
  readonly done: boolean;
  readonly href: string;
  readonly label: string;
  readonly detail: string;
};

type HomeConnectGuideProps = {
  readonly checklist: readonly ChecklistItem[];
  readonly orgSlug: string;
  /** Public web origin for Agent landing / llms.txt (e.g. http://localhost:3005). */
  readonly appBaseUrl?: string | undefined;
};

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
 * Home kickstart for remote agents: invite token + /llms.txt — not manual MCP config.
 */
export function HomeConnectGuide({
  checklist,
  orgSlug,
  appBaseUrl = 'http://localhost:3005',
}: HomeConnectGuideProps) {
  const origin = appBaseUrl.replace(/\/+$/, '');
  const agentLandingUrl = `${origin}/?audience=agent`;
  const llmsUrl = `${origin}/llms.txt`;
  const inviteHref = `/app/${orgSlug}/agents?add=invite`;

  const kickstartPrompt = useMemo(
    () =>
      [
        'Connect to agentOps as an autonomous agent.',
        `1. Open ${agentLandingUrl} (or fetch ${llmsUrl}) and follow it exactly.`,
        '2. Ask the human for a join invite token from Agents → Add agent → Invite with token.',
        '3. Redeem the token, then call agentops.onboard with the returned MCP credential.',
        '4. Do not invent tools — use the onboard contract.',
      ].join('\n'),
    [agentLandingUrl, llmsUrl],
  );

  return (
    <section aria-labelledby="home-connect-title" className="home-connect" data-tour="home-connect">
      <div className="home-connect-bar">
        <div className="home-connect-bar-lead">
          <span aria-hidden="true" className="home-connect-info-mark">i</span>
          <div>
            <h2 id="home-connect-title">Connect an agent</h2>
            <p>
              Hand Claude / Cursor a short prompt + invite token. They follow{' '}
              <a href="/llms.txt" rel="noreferrer" target="_blank">
                /llms.txt
              </a>{' '}
              and redeem — no manual MCP config on this page.
            </p>
          </div>
        </div>
        <div className="home-connect-bar-actions">
          <Link className="home-connect-toggle" href={inviteHref}>
            Create invite
          </Link>
          <CopyButton label="Copy agent prompt" value={kickstartPrompt} />
        </div>
      </div>

      <ol className="home-connect-steps" aria-label="Agent connect checklist">
        {checklist.map((item) => (
          <li className={item.done ? 'is-done' : undefined} key={item.label}>
            <span aria-hidden="true">{item.done ? '✓' : '○'}</span>
            <Link href={item.href} title={item.detail}>
              {item.label}
            </Link>
          </li>
        ))}
      </ol>

      <div className="home-connect-kickstart">
        <div className="home-connect-snippet">
          <CopyButton label="Copy prompt" value={kickstartPrompt} />
          <pre>{kickstartPrompt}</pre>
        </div>
        <p className="home-connect-kickstart-foot">
          <a href={agentLandingUrl} rel="noreferrer" target="_blank">
            Agent landing
          </a>
          {' · '}
          <a href={llmsUrl} rel="noreferrer" target="_blank">
            /llms.txt
          </a>
          {' · '}
          <Link href={inviteHref}>Agents → Add agent → Invite with token</Link>
        </p>
      </div>
    </section>
  );
}
