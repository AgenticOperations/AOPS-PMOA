'use client';

import { useActionState, useEffect, useState } from 'react';
import type { ConnectionActionState } from '@/app/actions/identity-spine';
import type { ConnectionRecord } from '@/lib/identity-spine-types';
import { formatUtcDateTime } from '@/lib/date-format';
import { formatConnectionKind, formatStatus } from './format';
import { AgentTablePager } from './AgentTablePager';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableShell } from '@/components/ui/table-shell';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

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
const PAGE_SIZE = 10;

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
  const [createOpen, setCreateOpen] = useState(newSecret !== undefined);
  const [createSession, setCreateSession] = useState(0);
  const [createPending, setCreatePending] = useState(false);
  const [initialSecretAvailable, setInitialSecretAvailable] = useState(newSecret !== undefined);
  const [page, setPage] = useState(1);
  const [selectedConnection, setSelectedConnection] = useState<ConnectionRecord | null>(null);
  const visibleConnections = connections.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const closeCreateDrawer = () => {
    if (createPending) return;
    setCreateOpen(false);
    setInitialSecretAvailable(false);
    setCreateSession((session) => session + 1);
  };

  return (
    <section className="agent-record-section" aria-labelledby="connections-title">
      <div className="agent-section-heading">
        <div>
          <h2 id="connections-title">Credentials</h2>
          <p>Runtime secrets issued to this identity. Secret values are shown only once.</p>
        </div>
        <button className="agent-secondary-button" disabled={createAction === undefined} onClick={() => setCreateOpen(true)} type="button">Create credential</button>
      </div>

      {connections.length === 0 ? (
          <div className="agent-table-empty">
            <strong>No credential issued</strong>
            <span>Create a connection when the agent is ready to call agentOps.</span>
          </div>
      ) : (
        <>
          <TableShell className="agent-record-table-shell" maxHeight={620}>
            <Table aria-label="Agent credentials" className="agent-record-table">
              <TableHeader><TableRow><TableHead>Credential</TableHead><TableHead>Kind</TableHead><TableHead>Status</TableHead><TableHead>Last used</TableHead><TableHead>Created</TableHead><TableHead aria-label="Open" /></TableRow></TableHeader>
              <TableBody>
                {visibleConnections.map((connection) => (
                  <TableRow key={connection.id}>
                    <TableCell data-label="Credential"><div className="agent-primary-cell"><span className="agent-entity-icon">KY</span><div><strong>{connection.name}</strong><code>{connection.id}</code></div></div></TableCell>
                    <TableCell data-label="Kind">{formatConnectionKind(connection.kind)}</TableCell>
                    <TableCell data-label="Status"><span className={`agent-status-badge is-${connection.status === 'active' ? 'active' : 'danger'}`}>{formatStatus(connection.status)}</span></TableCell>
                    <TableCell data-label="Last used">{connection.last_used_at === null ? 'Never' : formatUtcDateTime(connection.last_used_at)}</TableCell>
                    <TableCell data-label="Created">{formatUtcDateTime(connection.created_at)}</TableCell>
                    <TableCell className="agent-row-action" data-label=""><button onClick={() => setSelectedConnection(connection)} type="button">Open <span aria-hidden="true">→</span></button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableShell>
          <AgentTablePager itemLabel="credentials" onPageChange={setPage} page={page} pageSize={PAGE_SIZE} total={connections.length} />
        </>
      )}

      <Sheet
        labelledBy="create-credential-title"
        onOpenChange={(open) => {
          if (!open) closeCreateDrawer();
        }}
        open={createOpen}
        panelClassName="agent-action-sheet"
      >
        <SheetHeader>
          <div><SheetTitle id="create-credential-title">Create credential</SheetTitle><SheetDescription>Issue the one credential this agent uses to authenticate managed API and MCP calls.</SheetDescription></div>
          <SheetCloseButton disabled={createPending} onClick={closeCreateDrawer} />
        </SheetHeader>
        <CredentialCreateSession
          agentId={agentId}
          createAction={createAction}
          initialSecret={initialSecretAvailable ? newSecret : undefined}
          key={createSession}
          onPendingChange={setCreatePending}
          orgId={orgId}
          orgSlug={orgSlug}
        />
      </Sheet>

      <Sheet labelledBy="credential-detail-title" onOpenChange={(open) => !open && setSelectedConnection(null)} open={selectedConnection !== null} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div><SheetTitle id="credential-detail-title">Credential details</SheetTitle><SheetDescription>Inspect, test, rotate, or revoke this runtime credential.</SheetDescription></div>
          <SheetCloseButton onClick={() => setSelectedConnection(null)} />
        </SheetHeader>
        {selectedConnection !== null ? (
          <SheetBody>
            <dl className="agent-drawer-definitions">
              <div><dt>Name</dt><dd>{selectedConnection.name}</dd></div>
              <div><dt>Credential ID</dt><dd><code>{selectedConnection.id}</code></dd></div>
              <div><dt>Kind</dt><dd>{formatConnectionKind(selectedConnection.kind)}</dd></div>
              <div><dt>Status</dt><dd>{formatStatus(selectedConnection.status)}</dd></div>
              <div><dt>Secret</dt><dd>{selectedConnection.secret_last4 === null ? 'Not issued' : `Ending in ${selectedConnection.secret_last4}`}</dd></div>
              <div><dt>Last tested</dt><dd>{selectedConnection.last_tested_at === null ? 'Never' : formatUtcDateTime(selectedConnection.last_tested_at)}</dd></div>
              <div><dt>Last used</dt><dd>{selectedConnection.last_used_at === null ? 'Never' : formatUtcDateTime(selectedConnection.last_used_at)}</dd></div>
            </dl>
            {selectedConnection.status === 'active' ? (
              <div className="agent-drawer-action-section">
                <h3>Credential actions</h3>
                <ConnectionRowActions
                  agentId={agentId}
                  connectionId={selectedConnection.id}
                  orgId={orgId}
                  orgSlug={orgSlug}
                  revokeAction={revokeAction}
                  rotateAction={rotateAction}
                  testAction={testAction}
                />
              </div>
            ) : null}
          </SheetBody>
        ) : null}
      </Sheet>
    </section>
  );
}

function CredentialCreateSession({
  agentId,
  createAction,
  initialSecret,
  onPendingChange,
  orgId,
  orgSlug,
}: {
  readonly agentId: string;
  readonly createAction: ConnectionPanelProps['createAction'];
  readonly initialSecret: ConnectionPanelProps['newSecret'];
  readonly onPendingChange: (pending: boolean) => void;
  readonly orgId: string;
  readonly orgSlug: string;
}) {
  const [state, formAction, pending] = useActionState(createAction ?? (async () => initialState), initialState);
  const visibleSecret = state.secret ?? initialSecret;

  useEffect(() => {
    onPendingChange(pending);
  }, [onPendingChange, pending]);

  if (visibleSecret !== undefined) {
    return <SheetBody><CredentialSecretReveal secret={visibleSecret} title="Save this secret now" /></SheetBody>;
  }

  return (
    <form action={formAction} className="focus-form">
      <SheetBody className="operations-form">
        <input name="orgId" type="hidden" value={orgId} />
        <input name="orgSlug" type="hidden" value={orgSlug} />
        <input name="agentId" type="hidden" value={agentId} />
        <input name="kind" type="hidden" value="agent_credential" />
        <label><span>Credential name</span><input name="name" placeholder="Production worker" required /></label>
        {state.error !== undefined ? <p className="form-error" role="alert">{state.error}</p> : null}
        <button className="agent-primary-button agent-inline-submit" disabled={pending} type="submit">{pending ? 'Creating...' : 'Create credential'}</button>
      </SheetBody>
    </form>
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
            confirmation={{
              description: 'The current secret stops authenticating immediately. Historical activity remains available.',
              title: 'Revoke this credential?',
            }}
            connectionId={connectionId}
            label="Revoke credential"
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
  confirmation,
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
  readonly confirmation?: { readonly description: string; readonly title: string } | undefined;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(async (previousState: ConnectionActionState, formData: FormData) => {
    const nextState = await action(previousState, formData);
    if (nextState.error === undefined) setConfirming(false);
    return nextState;
  }, initialState);

  if (confirmation !== undefined && !confirming) {
    return <button className={buttonClassName} onClick={() => setConfirming(true)} type="button">{label}</button>;
  }

  return (
    <form action={formAction} className={confirmation === undefined ? 'credential-action-form' : 'credential-action-form is-confirming'}>
      <input name="orgId" type="hidden" value={orgId} />
      <input name="orgSlug" type="hidden" value={orgSlug} />
      <input name="agentId" type="hidden" value={agentId} />
      <input name="connectionId" type="hidden" value={connectionId} />
      {confirmation === undefined ? <button className={buttonClassName} disabled={pending} type="submit">{pending ? pendingLabel : label}</button> : <><div><strong>{confirmation.title}</strong><p>{confirmation.description}</p></div><div className="button-row"><button className="button-secondary" disabled={pending} onClick={() => setConfirming(false)} type="button">Keep credential</button><button className={buttonClassName} disabled={pending} type="submit">{pending ? pendingLabel : 'Confirm revoke'}</button></div></>}
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
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [pending, setPending] = useState(false);

  const closeDrawer = () => {
    if (pending) return;
    setOpen(false);
    setSession((value) => value + 1);
  };

  return (
    <>
      <button className="button-secondary" onClick={() => setOpen(true)} type="button">Rotate</button>
      <Sheet
        labelledBy={`rotate-credential-${connectionId}`}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeDrawer();
        }}
        open={open}
        panelClassName="agent-action-sheet"
      >
        <SheetHeader>
          <div><SheetTitle id={`rotate-credential-${connectionId}`}>Rotate credential</SheetTitle><SheetDescription>The current secret stops working immediately after rotation.</SheetDescription></div>
          <SheetCloseButton disabled={pending} onClick={closeDrawer} />
        </SheetHeader>
        <CredentialRotateSession
          action={action}
          agentId={agentId}
          connectionId={connectionId}
          key={session}
          onPendingChange={setPending}
          orgId={orgId}
          orgSlug={orgSlug}
        />
      </Sheet>
    </>
  );
}

function CredentialRotateSession({
  action,
  agentId,
  connectionId,
  onPendingChange,
  orgId,
  orgSlug,
}: {
  readonly action: NonNullable<ConnectionPanelProps['rotateAction']>;
  readonly agentId: string;
  readonly connectionId: string;
  readonly onPendingChange: (pending: boolean) => void;
  readonly orgId: string;
  readonly orgSlug: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    onPendingChange(pending);
  }, [onPendingChange, pending]);

  if (state.secret !== undefined) {
    return <SheetBody><CredentialSecretReveal secret={state.secret} title="Save this rotated secret now" /></SheetBody>;
  }

  return (
    <form action={formAction} className="focus-form">
      <SheetBody>
        <input name="orgId" type="hidden" value={orgId} />
        <input name="orgSlug" type="hidden" value={orgSlug} />
        <input name="agentId" type="hidden" value={agentId} />
        <input name="connectionId" type="hidden" value={connectionId} />
        <p className="drawer-confirm-copy">Create a replacement secret for this credential. Save it before closing the drawer.</p>
        {state.error !== undefined ? <span className="form-error" role="alert">{state.error}</span> : null}
        <button className="agent-primary-button agent-inline-submit" disabled={pending} type="submit">{pending ? 'Rotating...' : 'Rotate credential'}</button>
      </SheetBody>
    </form>
  );
}
