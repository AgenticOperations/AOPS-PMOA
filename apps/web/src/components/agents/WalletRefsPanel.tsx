import type { WalletRefRecord } from '@/lib/identity-spine-types';

export function WalletRefsPanel({
  orgId,
  orgSlug,
  agentId,
  walletRefs,
  attachAction,
  detachAction,
}: {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly agentId: string;
  readonly walletRefs: WalletRefRecord[];
  readonly attachAction?: ((formData: FormData) => Promise<void>) | undefined;
  readonly detachAction?: ((formData: FormData) => Promise<void>) | undefined;
}) {
  return (
    <section className="section-block" aria-labelledby="wallet-refs-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Optional metadata</p>
          <h2 id="wallet-refs-title">Wallet references</h2>
        </div>
        <p>Attach known wallet identifiers. Funding, signing, and payments stay in later sections.</p>
      </div>

      {attachAction !== undefined ? (
        <form action={attachAction} className="inline-form wallet-form">
          <input name="orgId" type="hidden" value={orgId} />
          <input name="orgSlug" type="hidden" value={orgSlug} />
          <input name="agentId" type="hidden" value={agentId} />
          <label>
            <span>Provider</span>
            <input name="provider" placeholder="circle_developer_controlled" required />
          </label>
          <label>
            <span>Wallet ID</span>
            <input name="externalWalletId" placeholder="wallet_..." />
          </label>
          <label>
            <span>Address</span>
            <input name="address" placeholder="0x..." />
          </label>
          <label>
            <span>Chain</span>
            <input name="chain" placeholder="arc-testnet" />
          </label>
          <label>
            <span>Label</span>
            <input name="label" placeholder="Managed wallet" />
          </label>
          <button className="button-primary" type="submit">
            Attach wallet
          </button>
        </form>
      ) : null}

      <div className="stack-list">
        {walletRefs.length === 0 ? (
          <div className="soft-row">
            <strong>No wallet references</strong>
            <span>This agent can be managed before any payment setup exists.</span>
          </div>
        ) : (
          walletRefs.map((walletRef) => (
            <article className="connection-row" key={walletRef.id}>
              <div>
                <strong>{walletRef.label || walletRef.provider}</strong>
                <span>
                  {walletRef.provider}
                  {walletRef.chain !== null ? ` / ${walletRef.chain}` : ''}
                </span>
                <span>{walletRef.address ?? walletRef.external_wallet_id ?? walletRef.id}</span>
              </div>
              {detachAction !== undefined ? (
                <form action={detachAction}>
                  <input name="orgId" type="hidden" value={orgId} />
                  <input name="orgSlug" type="hidden" value={orgSlug} />
                  <input name="agentId" type="hidden" value={agentId} />
                  <input name="walletRefId" type="hidden" value={walletRef.id} />
                  <button className="button-secondary" type="submit">
                    Detach
                  </button>
                </form>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
