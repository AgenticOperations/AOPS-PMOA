'use client';

import { useEffect, useRef, useState } from 'react';
import {
  safeMcpVerificationMessage,
  verifyHostedMcp,
  type McpVerificationResult,
} from '@/lib/mcp-verification';
import { buildLocalAdapterCommand } from '@/lib/local-adapter-command';

type CredentialMcpSetupProps = {
  readonly mcpEndpoint: string;
  readonly secret: {
    readonly connectionName: string;
    readonly secret: string;
  };
  readonly title: string;
};

type VerificationState =
  | { readonly state: 'idle' }
  | { readonly state: 'connecting' }
  | { readonly state: 'verified'; readonly result: McpVerificationResult }
  | { readonly state: 'failed'; readonly message: string };

const BOUNDARY_INSTRUCTION = 'Use AOPS before governed tool calls, HTTP operations, or x402 payments. Call the matching check tool first, follow approval requirements, and record the final outcome. Actions sent outside AOPS are not governed by this connection.';
const PAID_HTTP_EXAMPLE = `{
  "name": "agentops.payment_x402",
  "arguments": {
    "idempotency_key": "report-2026-07-13-001",
    "request": {
      "url": "https://api.example.com/reports",
      "method": "POST",
      "headers": [["content-type", "application/json"], ["accept", "application/json"]],
      "body": {"kind": "json", "value": {"range": "30d"}}
    }
  }
}`;

export function CredentialMcpSetup({ mcpEndpoint, secret, title }: CredentialMcpSetupProps) {
  const [copyStatus, setCopyStatus] = useState('');
  const [verification, setVerification] = useState<VerificationState>({ state: 'idle' });
  const copyAnnouncementTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const verificationController = useRef<AbortController | null>(null);
  const verificationAttempt = useRef(0);
  const claudeCodeConfig = `{
  "mcpServers": {
    "agentops": {
      "type": "http",
      "url": "${mcpEndpoint}",
      "headers": {
        "Authorization": "Bearer \${AGENTOPS_MCP_CREDENTIAL}"
      }
    }
  }
}`;
  const codexCommand = `codex mcp add agentops --url ${mcpEndpoint} --bearer-token-env-var AGENTOPS_MCP_CREDENTIAL`;
  const localAdapter = buildLocalAdapterCommand(secret.secret);

  useEffect(() => () => {
    if (copyAnnouncementTimer.current !== null) {
      globalThis.clearTimeout(copyAnnouncementTimer.current);
      copyAnnouncementTimer.current = null;
    }
    verificationAttempt.current += 1;
    verificationController.current?.abort();
    verificationController.current = null;
  }, [mcpEndpoint, secret.secret]);

  function announceCopyStatus(message: string) {
    if (copyAnnouncementTimer.current !== null) {
      globalThis.clearTimeout(copyAnnouncementTimer.current);
    }
    setCopyStatus('');
    copyAnnouncementTimer.current = globalThis.setTimeout(() => {
      setCopyStatus(message);
      copyAnnouncementTimer.current = null;
    }, 25);
  }

  async function copy(label: string, value: string) {
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      announceCopyStatus(`Copied ${label}`);
    } catch {
      announceCopyStatus('Copy unavailable');
    }
  }

  async function verify() {
    const attempt = verificationAttempt.current + 1;
    verificationAttempt.current = attempt;
    verificationController.current?.abort();
    const controller = new AbortController();
    verificationController.current = controller;
    setVerification({ state: 'connecting' });
    try {
      const result = await verifyHostedMcp({
        endpoint: mcpEndpoint,
        credential: secret.secret,
        signal: controller.signal,
      });
      if (verificationAttempt.current !== attempt || controller.signal.aborted) return;
      setVerification({ state: 'verified', result });
    } catch (error) {
      if (verificationAttempt.current !== attempt || controller.signal.aborted) return;
      setVerification({ state: 'failed', message: safeMcpVerificationMessage(error) });
    }
  }

  return (
    <div className="credential-mcp-setup" data-testid="credential-mcp-setup">
      <header className="mcp-setup-intro">
        <p className="eyebrow">Shown once</p>
        <h3>{title}</h3>
        <p>
          This credential for <strong>{secret.connectionName}</strong> disappears when you close
          this drawer. Copy the setup values before leaving.
        </p>
      </header>

      <section className="mcp-setup-section" aria-labelledby="mcp-credential-label">
        <div className="mcp-setup-section-heading">
          <h4 id="mcp-credential-label">Credential</h4>
          <button className="mcp-copy-button" onClick={() => void copy('credential', secret.secret)} type="button">Copy credential</button>
        </div>
        <code className="mcp-setup-code">{secret.secret}</code>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-endpoint-label">
        <div className="mcp-setup-section-heading">
          <div><h4 id="mcp-endpoint-label">Hosted MCP endpoint</h4><p>Use this URL from remote HTTP-capable MCP hosts.</p></div>
          <button className="mcp-copy-button" onClick={() => void copy('endpoint', mcpEndpoint)} type="button">Copy endpoint</button>
        </div>
        <code className="mcp-setup-code">{mcpEndpoint}</code>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-claude-code-label">
        <div className="mcp-setup-section-heading">
          <div><h4 id="mcp-claude-code-label">Claude Code</h4><p>Keep project configuration secret-free. Set AGENTOPS_MCP_CREDENTIAL in the host environment.</p></div>
          <button className="mcp-copy-button" onClick={() => void copy('Claude Code configuration', claudeCodeConfig)} type="button">Copy Claude Code configuration</button>
        </div>
        <pre className="mcp-setup-code">{claudeCodeConfig}</pre>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-codex-label">
        <div className="mcp-setup-section-heading">
          <div><h4 id="mcp-codex-label">Codex CLI</h4><p>Register the hosted MCP server and read the bearer token from the environment.</p></div>
          <button className="mcp-copy-button" onClick={() => void copy('Codex CLI command', codexCommand)} type="button">Copy Codex CLI command</button>
        </div>
        <code className="mcp-setup-code">{codexCommand}</code>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-local-adapter-label">
        <div className="mcp-setup-section-heading">
          <div><h4 id="mcp-local-adapter-label">Local repository adapter</h4><p>Requires a BUILD-PMOA checkout. Run this command from the repository root.</p></div>
          <button className="mcp-copy-button" onClick={() => void copy('local repository adapter', localAdapter)} type="button">Copy local repository adapter</button>
        </div>
        <pre className="mcp-setup-code">{localAdapter}</pre>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-paid-http-label">
        <div className="mcp-setup-section-heading">
          <div>
            <h4 id="mcp-paid-http-label">Governed paid HTTP</h4>
            <p>
              Use the public hosted MCP endpoint {mcpEndpoint} and authenticate with{' '}
              <code>{'Bearer ${AGENTOPS_MCP_CREDENTIAL}'}</code>. Keep the credential in the host
              environment, never in tool arguments or project files.
            </p>
          </div>
        </div>
        <pre className="mcp-setup-code">{PAID_HTTP_EXAMPLE}</pre>
        <p className="mcp-boundary-copy">
          If the call times out or returns a transient error, retry this exact request with the same
          idempotency_key. A settled replay returns the retained response without paying again. If
          the payment is submitting or unknown, keep the same key and retry to reconcile; never
          submit a new key.
        </p>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-boundary-label">
        <div className="mcp-setup-section-heading">
          <h4 id="mcp-boundary-label">Governance boundary</h4>
          <button className="mcp-copy-button" onClick={() => void copy('boundary instruction', BOUNDARY_INSTRUCTION)} type="button">Copy boundary instruction</button>
        </div>
        <p className="mcp-boundary-copy">{BOUNDARY_INSTRUCTION}</p>
      </section>

      <p className="mcp-copy-status" aria-atomic="true" aria-live="polite">{copyStatus}</p>

      <section className="mcp-verification" aria-labelledby="mcp-verification-label">
        <div className="mcp-verification-heading">
          <div><h4 id="mcp-verification-label">Connection check</h4><p>Authenticate directly with the hosted MCP service and discover its tool contract.</p></div>
          {verification.state === 'failed' ? (
            <button className="agent-primary-button" onClick={() => void verify()} type="button">Retry</button>
          ) : verification.state === 'verified' ? null : (
            <button className="agent-primary-button" disabled={verification.state === 'connecting'} onClick={() => void verify()} type="button">
              {verification.state === 'connecting' ? 'Verifying...' : 'Verify MCP connection'}
            </button>
          )}
        </div>

        <div className="mcp-verification-status" aria-live="polite">
          {verification.state === 'connecting' ? <p>Connecting to the hosted MCP service.</p> : null}
          {verification.state === 'failed' ? <p className="form-error">{verification.message}</p> : null}
          {verification.state === 'verified' ? (
            <div className="mcp-verification-result">
              <div><strong>Authenticated</strong><span>{verification.result.toolCount} tools discovered</span></div>
              <dl>
                <div><dt>Agent</dt><dd>{verification.result.agentName}</dd></div>
                <div><dt>Connection ID</dt><dd><code>{verification.result.connectionId}</code></dd></div>
                <div><dt>Contract version</dt><dd><code>{verification.result.contractVersion}</code></dd></div>
              </dl>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
