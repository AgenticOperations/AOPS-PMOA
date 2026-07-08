'use client';

import { useActionState } from 'react';
import type { ConnectionActionState } from '@/app/actions/identity-spine';
import type { ConnectionRecord } from '@/lib/identity-spine-types';
import { formatConnectionKind, formatStatus } from './format';

type ConnectionPanelProps = {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly agentId: string;
  readonly connections: ConnectionRecord[];
  readonly newSecret?: {
    readonly connectionName: string;
    readonly secret: string;
  } | undefined;
  readonly createAction?: ((
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>) | undefined;
  readonly rotateAction?: ((
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>) | undefined;
  readonly testAction?: ((
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>) | undefined;
  readonly revokeAction?: ((
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>) | undefined;
};

const initialState: ConnectionActionState = {};

export function ConnectionPanel({
  orgId,
  orgSlug,
  agentId,
  connections,
  newSecret,
  createAction,
  rotateAction,
  testAction,
  revokeAction,
}: ConnectionPanelProps) {
  const [createState, createFormAction, createPending] = useActionState(
    createAction ?? (async () => initialState),
    initialState,
  );
  const visibleSecret = createState.secret ?? newSecret;

  return (
    <section className="section-block" aria-labelledby="connections-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Agent access</p>
          <h2 id="connections-title">Access credential</h2>
        </div>
        <p>
          Issue the credential this agent will use to identify itself to agentOps. Scope and
          authorization rules are handled by later policy sections.
        </p>
      </div>

      {visibleSecret !== undefined ? (
        <CredentialSecretReveal secret={visibleSecret} title="Save this secret now" />
      ) : null}

      <form action={createFormAction} className="inline-form">
        <input name="orgId" type="hidden" value={orgId} />
        <input name="orgSlug" type="hidden" value={orgSlug} />
        <input name="agentId" type="hidden" value={agentId} />
        <input name="kind" type="hidden" value="agent_credential" />
        <label>
          <span>Credential name</span>
          <input name="name" placeholder="Production worker" required />
        </label>
        <button className="button-primary" disabled={createPending} type="submit">
          {createPending ? 'Creating credential...' : 'Create credential'}
        </button>
      </form>

      {createState.error !== undefined ? <p className="form-error">{createState.error}</p> : null}

      <div className="stack-list">
        {connections.length === 0 ? (
          <div className="soft-row">
            <strong>No credential issued</strong>
            <span>Create a connection when the agent is ready to call agentOps.</span>
          </div>
        ) : (
          connections.map((connection) => (
            <article className="connection-row" key={connection.id}>
              <div>
                <strong>{connection.name}</strong>
                <span>
                  {formatConnectionKind(connection.kind)} / {formatStatus(connection.status)}
                </span>
                {connection.secret_last4 !== null ? (
                  <span>ending in {connection.secret_last4}</span>
                ) : (
                  <span>No credential issued</span>
                )}
              </div>
              {connection.status === 'active' ? (
                <ConnectionRowActions
                  agentId={agentId}
                  connectionId={connection.id}
                  orgId={orgId}
                  orgSlug={orgSlug}
                  revokeAction={revokeAction}
                  rotateAction={rotateAction}
                  testAction={testAction}
                />
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function CredentialSecretReveal({
  secret,
  title,
}: {
  readonly secret: NonNullable<ConnectionActionState['secret']>;
  readonly title: string;
}) {
  return (
    <div className="secret-reveal" role="status">
      <div>
        <p className="eyebrow">Shown once</p>
        <h3>{title}</h3>
        <p>
          Store the secret for {secret.connectionName}. It will not be shown again after this setup
          step.
        </p>
      </div>
      <code>{secret.secret}</code>
      <pre>{`AGENTOPS_CONNECTION_SECRET=${secret.secret}`}</pre>
    </div>
  );
}

function ConnectionRowActions({
  orgId,
  orgSlug,
  agentId,
  connectionId,
  testAction,
  rotateAction,
  revokeAction,
}: {
  readonly orgId: string;
  readonly orgSlug: string;
  readonly agentId: string;
  readonly connectionId: string;
  readonly testAction?: ((
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>) | undefined;
  readonly rotateAction?: ((
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>) | undefined;
  readonly revokeAction?: ((
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>) | undefined;
}) {
  return (
    <div className="connection-actions">
      <div className="button-row">
        {testAction !== undefined ? (
          <ConnectionSubmitForm
            action={testAction}
            agentId={agentId}
            buttonClassName="button-secondary"
            connectionId={connectionId}
            label="Test"
            orgId={orgId}
            orgSlug={orgSlug}
            pendingLabel="Testing..."
          />
        ) : null}
        {rotateAction !== undefined ? (
          <ConnectionRotateForm
            action={rotateAction}
            agentId={agentId}
            connectionId={connectionId}
            orgId={orgId}
            orgSlug={orgSlug}
          />
        ) : null}
        {revokeAction !== undefined ? (
          <ConnectionSubmitForm
            action={revokeAction}
            agentId={agentId}
            buttonClassName="button-danger"
            connectionId={connectionId}
            label="Revoke"
            orgId={orgId}
            orgSlug={orgSlug}
            pendingLabel="Revoking..."
          />
        ) : null}
      </div>
    </div>
  );
}

function ConnectionSubmitForm({
  action,
  orgId,
  orgSlug,
  agentId,
  connectionId,
  label,
  pendingLabel,
  buttonClassName,
}: {
  readonly action: (
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>;
  readonly orgId: string;
  readonly orgSlug: string;
  readonly agentId: string;
  readonly connectionId: string;
  readonly label: string;
  readonly pendingLabel: string;
  readonly buttonClassName: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="credential-action-form">
      <input name="orgId" type="hidden" value={orgId} />
      <input name="orgSlug" type="hidden" value={orgSlug} />
      <input name="agentId" type="hidden" value={agentId} />
      <input name="connectionId" type="hidden" value={connectionId} />
      <button className={buttonClassName} disabled={pending} type="submit">
        {pending ? pendingLabel : label}
      </button>
      {state.message !== undefined ? <span className="form-success">{state.message}</span> : null}
      {state.error !== undefined ? <span className="form-error">{state.error}</span> : null}
    </form>
  );
}

function ConnectionRotateForm({
  action,
  orgId,
  orgSlug,
  agentId,
  connectionId,
}: {
  readonly action: (
    state: ConnectionActionState,
    formData: FormData,
  ) => Promise<ConnectionActionState>;
  readonly orgId: string;
  readonly orgSlug: string;
  readonly agentId: string;
  readonly connectionId: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="credential-rotate-action">
      <form action={formAction} className="credential-action-form">
        <input name="orgId" type="hidden" value={orgId} />
        <input name="orgSlug" type="hidden" value={orgSlug} />
        <input name="agentId" type="hidden" value={agentId} />
        <input name="connectionId" type="hidden" value={connectionId} />
        <button className="button-secondary" disabled={pending} type="submit">
          {pending ? 'Rotating...' : 'Rotate'}
        </button>
      </form>
      {state.error !== undefined ? <span className="form-error">{state.error}</span> : null}
      {state.secret !== undefined ? (
        <CredentialSecretReveal secret={state.secret} title="Save this rotated secret now" />
      ) : null}
    </div>
  );
}
