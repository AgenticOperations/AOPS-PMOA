'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { IconPlus, IconPlugConnected, IconTicket } from '@tabler/icons-react';
import type { JoinInviteActionState } from '@/app/actions/agent-join';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export type AgentSetupMode = 'mcp' | 'invite';

type AgentCreateDrawerProps = {
  readonly action: (formData: FormData) => Promise<void>;
  readonly inviteAction: (
    prev: JoinInviteActionState,
    formData: FormData,
  ) => Promise<JoinInviteActionState>;
  /** Open invite form immediately (e.g. from Home ?add=invite). */
  readonly initialOpenMode?: AgentSetupMode | null | undefined;
};

type AgentCreateState = {
  readonly error?: string;
};

const initialCreateState: AgentCreateState = {};
const initialInviteState: JoinInviteActionState = {};

export function AgentCreateDrawer({
  action,
  inviteAction,
  initialOpenMode = null,
}: AgentCreateDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(() => initialOpenMode !== null);
  const [step, setStep] = useState<'mode' | 'details' | 'invite-reveal'>(() =>
    initialOpenMode !== null ? 'details' : 'mode',
  );
  const [setupMode, setSetupMode] = useState<AgentSetupMode | null>(() => initialOpenMode);
  const [copyStatus, setCopyStatus] = useState('');
  const copyTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const didConsumeInitial = useRef(false);

  function clearAddQuery() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('add')) return;
    url.searchParams.delete('add');
    const qs = url.searchParams.toString();
    router.replace(qs.length > 0 ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function resetDrawer() {
    setStep('mode');
    setSetupMode(null);
    setCopyStatus('');
  }

  const [createState, createFormAction, createPending] = useActionState(
    async (_state: AgentCreateState, formData: FormData) => {
      try {
        await action(formData);
        setOpen(false);
        resetDrawer();
        clearAddQuery();
        return initialCreateState;
      } catch (error) {
        if (isRedirectError(error)) throw error;
        return { error: error instanceof Error ? error.message : 'Agent creation failed.' };
      }
    },
    initialCreateState,
  );

  const [inviteState, inviteFormAction, invitePending] = useActionState(inviteAction, initialInviteState);
  const pending = createPending || invitePending;

  useEffect(() => () => {
    if (copyTimer.current !== null) globalThis.clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    if (inviteState.token !== undefined && setupMode === 'invite') {
      setStep('invite-reveal');
    }
  }, [inviteState.token, setupMode]);

  useEffect(() => {
    if (didConsumeInitial.current) return;
    if (initialOpenMode === null) return;
    didConsumeInitial.current = true;
    setOpen(true);
    setSetupMode(initialOpenMode);
    setStep('details');
  }, [initialOpenMode]);

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      resetDrawer();
      clearAddQuery();
    }
  }

  function chooseMode(mode: AgentSetupMode) {
    setSetupMode(mode);
    setStep('details');
  }

  async function copyToken(value: string) {
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (copyTimer.current !== null) globalThis.clearTimeout(copyTimer.current);
      setCopyStatus('');
      copyTimer.current = globalThis.setTimeout(() => {
        setCopyStatus('Copied');
        copyTimer.current = null;
      }, 25);
    } catch {
      setCopyStatus('Copy failed — select the token manually');
    }
  }

  const title =
    step === 'mode'
      ? 'Add an agent'
      : step === 'invite-reveal'
        ? 'Invite token ready'
        : setupMode === 'invite'
          ? 'Invite a remote agent'
          : 'Name the agent';

  const description =
    step === 'mode'
      ? 'Create the identity here, or hand an invite token to Claude / Cursor. Publish stays on the agent detail page.'
      : step === 'invite-reveal'
        ? 'Copy once and give it to the agent. It is not shown in plaintext again. Payment stays off until you enable it.'
        : setupMode === 'mcp'
          ? 'Then issue a credential and connect Cursor or Claude via MCP. Publish later from the agent’s Publish tab if needed.'
          : 'Creates a join token the agent redeems for MCP URL + credential.';

  return (
    <>
      <button
        className="console-primary-button"
        data-tour="add-agent"
        onClick={() => handleOpenChange(true)}
        type="button"
      >
        <IconPlus aria-hidden="true" size={16} stroke={2} />
        Add agent
      </button>
      <Sheet labelledBy="create-agent-title" onOpenChange={handleOpenChange} open={open} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div>
            <SheetTitle id="create-agent-title">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </div>
          <SheetCloseButton disabled={pending} onClick={() => handleOpenChange(false)} />
        </SheetHeader>

        {step === 'mode' ? (
          <SheetBody>
            <div className="agent-setup-mode-grid" role="group" aria-label="Agent setup mode">
              <button className="agent-setup-mode-card" onClick={() => chooseMode('mcp')} type="button">
                <span className="agent-setup-mode-icon" aria-hidden="true">
                  <IconPlugConnected size={22} stroke={1.6} />
                </span>
                <strong>Create in console</strong>
                <span>Register the identity here, then issue an MCP credential for Cursor or Claude.</span>
              </button>
              <button className="agent-setup-mode-card" onClick={() => chooseMode('invite')} type="button">
                <span className="agent-setup-mode-icon" aria-hidden="true">
                  <IconTicket size={22} stroke={1.6} />
                </span>
                <strong>Invite with token</strong>
                <span>Copy a one-time join token. The agent redeems it and joins under this org (payment off).</span>
              </button>
            </div>
          </SheetBody>
        ) : null}

        {step === 'details' && setupMode === 'mcp' ? (
          <form action={createFormAction} className="focus-form">
            <SheetBody>
              <section className="agent-drawer-form-section">
                <h3>Identity</h3>
                <input name="setup_mode" type="hidden" value="mcp" />
                <label className="focus-field">
                  <span>Agent name</span>
                  <input aria-label="Agent name" autoComplete="off" name="name" placeholder="Research agent" required />
                  <small>Used across policies, approvals, and credentials.</small>
                </label>
              </section>
              {createState.error !== undefined ? <p className="form-error" role="alert">{createState.error}</p> : null}
              <div className="agent-setup-detail-actions">
                <button className="agent-secondary-button" disabled={pending} onClick={() => setStep('mode')} type="button">
                  Back
                </button>
                <button className="agent-primary-button agent-inline-submit" disabled={pending} type="submit">
                  {pending ? 'Creating...' : 'Create agent'}
                </button>
              </div>
            </SheetBody>
          </form>
        ) : null}

        {step === 'details' && setupMode === 'invite' ? (
          <form action={inviteFormAction} className="focus-form">
            <SheetBody>
              <section className="agent-drawer-form-section">
                <h3>Invite</h3>
                <label className="focus-field">
                  <span>Label</span>
                  <input name="label" placeholder="Sandbox cohort" type="text" />
                  <small>Optional — helps you recognize this invite later.</small>
                </label>
                <label className="focus-field">
                  <span>Max uses</span>
                  <input defaultValue={1} max={10000} min={1} name="max_uses" type="number" />
                </label>
                <label className="focus-field">
                  <span>Expires in hours</span>
                  <input max={2160} min={1} name="expires_in_hours" placeholder="24 (optional)" type="number" />
                </label>
              </section>
              {inviteState.error !== undefined ? <p className="form-error" role="alert">{inviteState.error}</p> : null}
              <div className="agent-setup-detail-actions">
                <button className="agent-secondary-button" disabled={pending} onClick={() => setStep('mode')} type="button">
                  Back
                </button>
                <button className="agent-primary-button agent-inline-submit" disabled={pending} type="submit">
                  {pending ? 'Creating…' : 'Create invite token'}
                </button>
              </div>
            </SheetBody>
          </form>
        ) : null}

        {step === 'invite-reveal' && inviteState.token !== undefined ? (
          <SheetBody className="join-invite-reveal">
            <p className="eyebrow">Shown once</p>
            <label className="focus-field">
              <span>Invite token</span>
              <code className="mcp-setup-code">{inviteState.token}</code>
            </label>
            <div className="join-invite-reveal-actions">
              <button
                className="agent-primary-button"
                onClick={() => void copyToken(inviteState.token!)}
                type="button"
              >
                Copy token
              </button>
              <button className="agent-secondary-button" onClick={() => handleOpenChange(false)} type="button">
                Done
              </button>
            </div>
            {inviteState.redeemUrl !== undefined ? (
              <p className="join-invite-hint">
                Tell the agent to open Agent mode / <code>/llms.txt</code>, ask you for the
                display name, then redeem with{' '}
                <code>{`{ "token": "<paste>", "agent_name": "<name>" }`}</code> at{' '}
                <code>POST {inviteState.redeemUrl}</code>.
              </p>
            ) : null}
            <p aria-live="polite" className="join-invite-copy-status">
              {copyStatus}
            </p>
          </SheetBody>
        ) : null}
      </Sheet>
    </>
  );
}
