'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { JoinInviteActionState } from '@/app/actions/agent-join';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type JoinInviteCreateDrawerProps = {
  readonly action: (
    prev: JoinInviteActionState,
    formData: FormData,
  ) => Promise<JoinInviteActionState>;
};

const initialState: JoinInviteActionState = {};

export function JoinInviteCreateDrawer({ action }: JoinInviteCreateDrawerProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'form' | 'reveal'>('form');
  const [state, formAction, pending] = useActionState(action, initialState);
  const [copyStatus, setCopyStatus] = useState('');
  const copyTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const shownToken = view === 'reveal' ? state.token : undefined;

  useEffect(() => () => {
    if (copyTimer.current !== null) globalThis.clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    if (state.token !== undefined) {
      setView('reveal');
      setOpen(true);
    }
  }, [state.token]);

  async function copy(value: string) {
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

  function closeDrawer() {
    if (pending) return;
    setOpen(false);
    setCopyStatus('');
    setView('form');
  }

  return (
    <>
      <button
        className="console-primary-button"
        onClick={() => {
          setCopyStatus('');
          setView('form');
          setOpen(true);
        }}
        type="button"
      >
        Create invite
      </button>
      <Sheet
        labelledBy="join-invite-create-title"
        onOpenChange={(next) => {
          if (!pending) {
            setOpen(next);
            if (!next) {
              setCopyStatus('');
              setView('form');
            }
          }
        }}
        open={open}
        panelClassName="settings-drawer"
      >
        <SheetHeader>
          <div>
            <SheetTitle id="join-invite-create-title">
              {shownToken !== undefined ? 'Invite token ready' : 'Create join invite'}
            </SheetTitle>
            <SheetDescription>
              {shownToken !== undefined
                ? 'Copy this token once and give it to the agent. It is not stored in plaintext here again.'
                : 'Agents redeem this token for an MCP URL and credential. Payment access stays disabled until you enable it.'}
            </SheetDescription>
          </div>
          <SheetCloseButton disabled={pending} onClick={closeDrawer} />
        </SheetHeader>

        {shownToken !== undefined ? (
          <SheetBody className="settings-drawer-form join-invite-reveal">
            <p className="eyebrow">Shown once</p>
            <label>
              <span>Invite token</span>
              <code className="mcp-setup-code">{shownToken}</code>
            </label>
            <div className="join-invite-reveal-actions">
              <button className="settings-button settings-button-primary" onClick={() => void copy(shownToken)} type="button">
                Copy token
              </button>
              <button className="settings-button" onClick={closeDrawer} type="button">
                Done
              </button>
            </div>
            {state.redeemUrl !== undefined ? (
              <p className="join-invite-hint">
                Agent redeems via <code>POST {state.redeemUrl}</code> with{' '}
                <code>{`{ "token": "<paste>" }`}</code>
              </p>
            ) : null}
            <p aria-live="polite" className="join-invite-copy-status">
              {copyStatus}
            </p>
          </SheetBody>
        ) : (
          <form action={formAction} className="focus-form">
            <SheetBody className="settings-drawer-form">
              <label>
                <span>Label</span>
                <input name="label" placeholder="Sandbox cohort" type="text" />
              </label>
              <label>
                <span>Max uses</span>
                <input defaultValue={1} max={10000} min={1} name="max_uses" type="number" />
              </label>
              <label>
                <span>Expires in hours (optional)</span>
                <input max={2160} min={1} name="expires_in_hours" placeholder="24" type="number" />
              </label>
              {state.error !== undefined ? (
                <p className="form-error" role="alert">
                  {state.error}
                </p>
              ) : null}
              <button
                className="settings-button settings-button-primary settings-form-submit"
                disabled={pending}
                type="submit"
              >
                {pending ? 'Creating…' : 'Create invite'}
              </button>
            </SheetBody>
          </form>
        )}
      </Sheet>
    </>
  );
}
