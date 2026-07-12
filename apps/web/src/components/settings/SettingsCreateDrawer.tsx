'use client';

import { useActionState, useState } from 'react';
import type { Role } from '@/lib/identity-spine-types';
import { Sheet, SheetBody, SheetCloseButton, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type SettingsCreateDrawerProps = {
  readonly action: (formData: FormData) => Promise<void>;
  readonly mode: 'member' | 'team';
  readonly roles?: readonly Role[] | undefined;
};

type ActionState = { readonly error?: string };
const initialState: ActionState = {};

function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function SettingsCreateDrawer({ action, mode, roles = [] }: SettingsCreateDrawerProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (_state: ActionState, formData: FormData) => {
    try {
      await action(formData);
      setOpen(false);
      return initialState;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The action could not be completed.' };
    }
  }, initialState);
  const memberMode = mode === 'member';
  const title = memberMode ? 'Add member' : 'Create team';

  return (
    <>
      <button className="settings-button settings-button-primary" onClick={() => setOpen(true)} type="button">{title}</button>
      <Sheet labelledBy={`settings-${mode}-title`} onOpenChange={(nextOpen) => !pending && setOpen(nextOpen)} open={open} panelClassName="settings-drawer">
        <SheetHeader><div><SheetTitle id={`settings-${mode}-title`}>{title}</SheetTitle><SheetDescription>{memberMode ? 'Add an operator and assign their initial workspace role.' : 'Create a scope for agents, policies, and operational limits.'}</SheetDescription></div><SheetCloseButton disabled={pending} onClick={() => setOpen(false)} /></SheetHeader>
        <form action={formAction} className="focus-form">
          <SheetBody className="settings-drawer-form">
            {memberMode ? <><label><span>Email</span><input name="email" placeholder="operator@company.com" required type="email" /></label><label><span>Name</span><input name="name" placeholder="Operator name" /></label><label><span>Role</span><select defaultValue="viewer" name="role">{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label></> : <><label><span>Name</span><input name="name" placeholder="Analysis" required /></label><label><span>Description</span><textarea name="description" placeholder="Which agents and operating scope belong here" rows={4} /></label></>}
            {state.error !== undefined ? <p className="form-error" role="alert">{state.error}</p> : null}
            <button className="settings-button settings-button-primary settings-form-submit" disabled={pending} type="submit">{pending ? 'Saving…' : title}</button>
          </SheetBody>
        </form>
      </Sheet>
    </>
  );
}
