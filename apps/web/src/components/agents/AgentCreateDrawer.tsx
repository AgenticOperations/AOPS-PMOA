'use client';

import { useActionState, useState } from 'react';
import { IconPlus } from '@tabler/icons-react';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

type AgentCreateDrawerProps = {
  readonly action: (formData: FormData) => Promise<void>;
};

type AgentCreateState = {
  readonly error?: string;
};

const initialState: AgentCreateState = {};

export function AgentCreateDrawer({ action }: AgentCreateDrawerProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (_state: AgentCreateState, formData: FormData) => {
    try {
      await action(formData);
      setOpen(false);
      return initialState;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Agent creation failed.' };
    }
  }, initialState);

  return (
    <>
      <button className="console-primary-button" onClick={() => setOpen(true)} type="button">
        <IconPlus aria-hidden="true" size={16} stroke={2} />
        Add agent
      </button>
      <Sheet labelledBy="create-agent-title" onOpenChange={setOpen} open={open} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div>
            <SheetTitle id="create-agent-title">Add agent</SheetTitle>
            <SheetDescription>Create the identity now. Credentials and policies remain separate controls.</SheetDescription>
          </div>
          <SheetCloseButton onClick={() => setOpen(false)} />
        </SheetHeader>
        <form action={formAction} className="focus-form">
          <SheetBody>
            <section className="agent-drawer-form-section">
              <h3>Identity</h3>
              <label className="focus-field">
                <span>Agent name</span>
                <input aria-label="Agent name" autoComplete="off" name="name" placeholder="Research agent" required />
                <small>The operator-facing name used across policies, approvals, and evidence.</small>
              </label>
            </section>
            {state.error !== undefined ? <p className="form-error" role="alert">{state.error}</p> : null}
            <button className="agent-primary-button agent-inline-submit" disabled={pending} type="submit">
              {pending ? 'Creating...' : 'Create agent'}
            </button>
          </SheetBody>
        </form>
      </Sheet>
    </>
  );
}
