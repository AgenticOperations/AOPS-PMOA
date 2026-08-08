'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { IconCheck, IconExternalLink } from '@tabler/icons-react';

export type AgentOnchainIdentityView = {
  readonly token_id: string | null;
  readonly agent_uri: string;
  readonly register_tx_hash: string | null;
  readonly status: 'pending' | 'registered' | 'failed';
  readonly registry_address: string;
  readonly chain: string;
} | null;

export type PublishIdentityFormState = {
  readonly error?: string;
  readonly ok?: string;
};

type AgentPublishPanelProps = {
  readonly templateRepoUrl: string;
  readonly marketplaceHref: string;
  readonly credentialsHref: string;
  readonly endpointUrl: string;
  readonly identity: AgentOnchainIdentityView;
  readonly saveListingAction: (formData: FormData) => Promise<void>;
  readonly registerIdentityAction: (formData: FormData) => Promise<PublishIdentityFormState>;
};

type FormState = PublishIdentityFormState;

const explorerBase = 'https://testnet.arcscan.app';
const arcNanopaymentsUrl = 'https://github.com/circlefin/arc-nanopayments';

function shortHash(value: string): string {
  if (value.length < 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function AgentPublishPanel({
  templateRepoUrl,
  marketplaceHref,
  credentialsHref,
  endpointUrl,
  identity,
  saveListingAction,
  registerIdentityAction,
}: AgentPublishPanelProps) {
  const [listingState, listingAction, listingPending] = useActionState(
    async (_state: FormState, formData: FormData): Promise<FormState> => {
      try {
        await saveListingAction(formData);
        return { ok: 'Saved.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Could not save endpoint.' };
      }
    },
    {},
  );

  const [registerState, registerAction, registerPending] = useActionState(
    async (_state: FormState, formData: FormData): Promise<FormState> => {
      try {
        const result = await registerIdentityAction(formData);
        if (result.error !== undefined || result.ok !== undefined) return result;
        return { ok: 'Registered on Arc.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Identity registration failed.' };
      }
    },
    {},
  );

  const registered = identity?.status === 'registered';
  const hasEndpoint = endpointUrl.trim().length > 0;

  return (
    <div className="agent-detail-canvas agent-publish-canvas">
      <section className="agent-detail-section agent-publish-block" aria-labelledby="publish-host-title">
        <div className="agent-section-heading">
          <div>
            <h2 id="publish-host-title">Host</h2>
          </div>
        </div>

        <div className="agent-publish-options">
          <article className="agent-publish-option">
            <h3>Arc template</h3>
            <p>Clone nanopayments, add the AgentOps overlay, deploy HTTPS.</p>
            <div className="agent-publish-option-actions">
              <a className="agent-secondary-button agent-publish-repo-link" href={arcNanopaymentsUrl} rel="noreferrer" target="_blank">
                Get template
                <IconExternalLink aria-hidden="true" size={14} stroke={1.8} />
              </a>
              <a className="agent-publish-text-link" href={templateRepoUrl} rel="noreferrer" target="_blank">
                Overlay
              </a>
              <Link className="agent-publish-text-link" href={credentialsHref}>Credentials</Link>
            </div>
          </article>

          <article className="agent-publish-option">
            <h3>Your own agent</h3>
            <p>Any public HTTPS seller. Paste its URL below.</p>
          </article>
        </div>
      </section>

      <section className="agent-detail-section agent-publish-block" aria-labelledby="publish-endpoint-title">
        <div className="agent-section-heading">
          <div>
            <h2 id="publish-endpoint-title">Endpoint</h2>
          </div>
        </div>
        <form action={listingAction} className="agent-publish-form">
          <label className="focus-field">
            <span className="sr-only">Hosted URL</span>
            <input
              defaultValue={endpointUrl}
              name="endpoint_url"
              placeholder="https://…"
              required
              type="url"
            />
          </label>
          {listingState.error !== undefined ? <p className="form-error" role="alert">{listingState.error}</p> : null}
          {listingState.ok !== undefined ? <p className="agent-publish-ok" role="status">{listingState.ok}</p> : null}
          <button className="agent-secondary-button" disabled={listingPending} type="submit">
            {listingPending ? 'Saving…' : 'Save'}
          </button>
        </form>
      </section>

      <section className="agent-detail-section agent-publish-block" aria-labelledby="publish-identity-title">
        <div className="agent-section-heading">
          <div>
            <h2 id="publish-identity-title">Identity</h2>
          </div>
        </div>

        {registered && identity !== null ? (
          <div className="agent-publish-identity-card is-registered">
            <p className="agent-publish-identity-status">
              <IconCheck aria-hidden="true" size={16} stroke={2} />
              Registered
            </p>
            <dl className="agent-publish-meta">
              <div>
                <dt>Token</dt>
                <dd><code>{identity.token_id ?? '—'}</code></dd>
              </div>
              {identity.register_tx_hash !== null ? (
                <div>
                  <dt>Tx</dt>
                  <dd>
                    <a href={`${explorerBase}/tx/${identity.register_tx_hash}`} rel="noreferrer" target="_blank">
                      <code>{shortHash(identity.register_tx_hash)}</code>
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : (
          <form action={registerAction} className="agent-publish-form agent-publish-form-inline">
            <input name="endpoint_url" type="hidden" value={endpointUrl} />
            {!hasEndpoint ? <p className="agent-publish-hint">Save endpoint first.</p> : null}
            {registerState.error !== undefined ? <p className="form-error" role="alert">{registerState.error}</p> : null}
            {registerState.ok !== undefined ? <p className="agent-publish-ok" role="status">{registerState.ok}</p> : null}
            <button
              className="agent-primary-button"
              disabled={registerPending || !hasEndpoint}
              type="submit"
            >
              {registerPending ? 'Registering…' : 'Register on Arc'}
            </button>
          </form>
        )}
      </section>

      <section className="agent-detail-section agent-publish-block agent-publish-hire" aria-labelledby="publish-hire-title">
        <div className="agent-section-heading">
          <div>
            <h2 id="publish-hire-title">Hire</h2>
          </div>
        </div>
        <Link className="agent-secondary-button agent-publish-repo-link" href={marketplaceHref}>
          Marketplace
          <IconExternalLink aria-hidden="true" size={14} stroke={1.8} />
        </Link>
      </section>
    </div>
  );
}
