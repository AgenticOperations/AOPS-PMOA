'use client';

import { useState } from 'react';
import {
  safeMcpVerificationMessage,
  verifyHostedMcp,
  type McpVerificationResult,
} from '@/lib/mcp-verification';

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

export function CredentialMcpSetup({ mcpEndpoint, secret, title }: CredentialMcpSetupProps) {
  const [copyStatus, setCopyStatus] = useState('');
  const [verification, setVerification] = useState<VerificationState>({ state: 'idle' });
  const localStdio = `AGENTOPS_MCP_CREDENTIAL=${secret.secret}`;
  const remoteConfig = JSON.stringify({
    mcpServers: {
      agentops: {
        type: 'http',
        url: mcpEndpoint,
        headers: { Authorization: `Bearer ${secret.secret}` },
      },
    },
  }, null, 2);

  async function copy(label: string, value: string) {
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopyStatus(`Copied ${label}`);
    } catch {
      setCopyStatus('Copy unavailable');
    }
  }

  async function verify() {
    setVerification({ state: 'connecting' });
    try {
      const result = await verifyHostedMcp({ endpoint: mcpEndpoint, credential: secret.secret });
      setVerification({ state: 'verified', result });
    } catch (error) {
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

      <section className="mcp-setup-section" aria-labelledby="mcp-remote-label">
        <div className="mcp-setup-section-heading">
          <div><h4 id="mcp-remote-label">Remote JSON configuration</h4><p>Paste this object into your MCP host configuration.</p></div>
          <button className="mcp-copy-button" onClick={() => void copy('remote configuration', remoteConfig)} type="button">Copy remote configuration</button>
        </div>
        <pre className="mcp-setup-code">{remoteConfig}</pre>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-stdio-label">
        <div className="mcp-setup-section-heading">
          <div><h4 id="mcp-stdio-label">Local stdio</h4><p>Set this environment variable for the local MCP adapter.</p></div>
          <button className="mcp-copy-button" onClick={() => void copy('local stdio configuration', localStdio)} type="button">Copy local stdio configuration</button>
        </div>
        <code className="mcp-setup-code">{localStdio}</code>
      </section>

      <section className="mcp-setup-section" aria-labelledby="mcp-boundary-label">
        <div className="mcp-setup-section-heading">
          <h4 id="mcp-boundary-label">Governance boundary</h4>
          <button className="mcp-copy-button" onClick={() => void copy('boundary instruction', BOUNDARY_INSTRUCTION)} type="button">Copy boundary instruction</button>
        </div>
        <p className="mcp-boundary-copy">{BOUNDARY_INSTRUCTION}</p>
      </section>

      <p className="mcp-copy-status" aria-live="polite">{copyStatus}</p>

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
