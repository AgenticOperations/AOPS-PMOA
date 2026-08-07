'use client';

import { useActionState } from 'react';
import { IconExternalLink, IconCheck } from '@tabler/icons-react';

export type AgentOnchainIdentityView = {
  readonly token_id: string | null;
  readonly agent_uri: string;
  readonly register_tx_hash: string | null;
  readonly status: 'pending' | 'registered' | 'failed';
  readonly registry_address: string;
  readonly chain: string;
} | null;

type AgentPublishPanelProps = {
  readonly templateRepoUrl: string;
  readonly endpointUrl: string;
  readonly identity: AgentOnchainIdentityView;
  readonly saveListingAction: (formData: FormData) => Promise<void>;
  readonly registerIdentityAction: (formData: FormData) => Promise<void>;
};

type FormState = { readonly error?: string; readonly ok?: string };

const explorerBase = 'https://testnet.arcscan.app';

export function AgentPublishPanel({
  templateRepoUrl,
  endpointUrl,
  identity,
  saveListingAction,
  registerIdentityAction,
}: AgentPublishPanelProps) {
  const [listingState, listingAction, listingPending] = useActionState(
    async (_state: FormState, formData: FormData): Promise<FormState> => {
      try {
        await saveListingAction(formData);
        return { ok: 'Endpoint saved.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Could not save endpoint.' };
      }
    },
    {},
  );

  const [registerState, registerAction, registerPending] = useActionState(
    async (_state: FormState, formData: FormData): Promise<FormState> => {
      try {
        await registerIdentityAction(formData);
        return { ok: 'Identity registered on Arc.' };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Identity registration failed.' };
      }
    },
    {},
  );

  const registered = identity?.status === 'registered';

  return (
    <div className="agent-detail-canvas agent-publish-canvas">
      <section className="agent-detail-section" aria-labelledby="publish-template-title">
        <div className="agent-section-heading">
          <div>
            <h2 id="publish-template-title">1. Host from Arc template</h2>
            <p>
              Use Circle&apos;s official nanopayments sample — seller x402 endpoints buyers can pay.
              AgentOps adds credential, policy, and on-chain identity.
            </p>
          </div>
        </div>
        <ol className="agent-publish-steps">
          <li>Clone the template and follow its README (Supabase, wallets, <code>npm run dev</code>).</li>
          <li>Issue an AgentOps credential on the Credentials tab if this agent will spend.</li>
          <li>Deploy or tunnel a public HTTPS URL for the seller app.</li>
          <li>Paste that URL below and register ERC-8004 identity.</li>
        </ol>
        <a className="agent-primary-button agent-publish-repo-link" href={templateRepoUrl} rel="noreferrer" target="_blank">
          Open arc-nanopayments
          <IconExternalLink aria-hidden="true" size={16} stroke={1.8} />
        </a>
      </section>

      <section className="agent-detail-section" aria-labelledby="publish-endpoint-title">
        <div className="agent-section-heading">
          <div>
            <h2 id="publish-endpoint-title">2. Public endpoint</h2>
            <p>The hireable base URL other agents will call (e.g. your hosted nanopayments origin).</p>
          </div>
        </div>
        <form action={listingAction} className="agent-publish-form">
          <label className="focus-field">
            <span>Hosted URL</span>
            <input
              defaultValue={endpointUrl}
              name="endpoint_url"
              placeholder="https://your-nanopayments.example.com"
              required
              type="url"
            />
            <small>Must be publicly reachable. Reputation is earned later from settled escrow — not at publish.</small>
          </label>
          {listingState.error !== undefined ? <p className="form-error" role="alert">{listingState.error}</p> : null}
          {listingState.ok !== undefined ? <p className="agent-publish-ok" role="status">{listingState.ok}</p> : null}
          <button className="agent-secondary-button" disabled={listingPending} type="submit">
            {listingPending ? 'Saving…' : 'Save endpoint'}
          </button>
        </form>
      </section>

      <section className="agent-detail-section" aria-labelledby="publish-identity-title">
        <div className="agent-section-heading">
          <div>
            <h2 id="publish-identity-title">3. Register ERC-8004 identity</h2>
            <p>
              Mints the agent&apos;s identity NFT on Arc from its developer-controlled wallet.
              Requires the agent wallet to be provisioned and funded for gas.
            </p>
          </div>
        </div>

        {registered ? (
          <div className="agent-publish-identity-card is-registered">
            <p className="agent-publish-identity-status">
              <IconCheck aria-hidden="true" size={18} stroke={2} />
              Registered on Arc
            </p>
            <dl className="agent-definition-list">
              <div>
                <dt>Token ID</dt>
                <dd><code>{identity.token_id ?? '—'}</code></dd>
              </div>
              <div>
                <dt>Agent URI</dt>
                <dd><code>{identity.agent_uri}</code></dd>
              </div>
              <div>
                <dt>Registry</dt>
                <dd>
                  <a href={`${explorerBase}/address/${identity.registry_address}`} rel="noreferrer" target="_blank">
                    <code>{identity.registry_address}</code>
                  </a>
                </dd>
              </div>
              {identity.register_tx_hash !== null ? (
                <div>
                  <dt>Register tx</dt>
                  <dd>
                    <a href={`${explorerBase}/tx/${identity.register_tx_hash}`} rel="noreferrer" target="_blank">
                      <code>{identity.register_tx_hash}</code>
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : (
          <form action={registerAction} className="agent-publish-form">
            <input name="endpoint_url" type="hidden" value={endpointUrl} />
            {endpointUrl.length === 0 ? (
              <p className="agent-publish-hint">Save a public endpoint above before registering.</p>
            ) : null}
            {registerState.error !== undefined ? <p className="form-error" role="alert">{registerState.error}</p> : null}
            {registerState.ok !== undefined ? <p className="agent-publish-ok" role="status">{registerState.ok}</p> : null}
            <button
              className="agent-primary-button"
              disabled={registerPending || endpointUrl.length === 0}
              type="submit"
            >
              {registerPending ? 'Registering on Arc…' : 'Register identity on Arc'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
