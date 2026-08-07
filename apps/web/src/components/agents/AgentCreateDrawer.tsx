'use client';

import { useActionState, useState } from 'react';
import { IconPlus, IconPlugConnected, IconWorldWww } from '@tabler/icons-react';
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export type AgentSetupMode = 'mcp' | 'publish';

type AgentCreateDrawerProps = {
  readonly action: (formData: FormData) => Promise<void>;
  readonly templateRepoUrl?: string | undefined;
};

type AgentCreateState = {
  readonly error?: string;
};

const initialState: AgentCreateState = {};

const DEFAULT_TEMPLATE_REPO = 'https://github.com/circlefin/arc-nanopayments';

export function AgentCreateDrawer({
  action,
  templateRepoUrl = DEFAULT_TEMPLATE_REPO,
}: AgentCreateDrawerProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'mode' | 'details'>('mode');
  const [setupMode, setSetupMode] = useState<AgentSetupMode | null>(null);
  const [state, formAction, pending] = useActionState(async (_state: AgentCreateState, formData: FormData) => {
    try {
      await action(formData);
      setOpen(false);
      setStep('mode');
      setSetupMode(null);
      return initialState;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Agent creation failed.' };
    }
  }, initialState);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep('mode');
      setSetupMode(null);
    }
  }

  function chooseMode(mode: AgentSetupMode) {
    setSetupMode(mode);
    setStep('details');
  }

  return (
    <>
      <button className="console-primary-button" onClick={() => handleOpenChange(true)} type="button">
        <IconPlus aria-hidden="true" size={16} stroke={2} />
        Add agent
      </button>
      <Sheet labelledBy="create-agent-title" onOpenChange={handleOpenChange} open={open} panelClassName="agent-action-sheet">
        <SheetHeader>
          <div>
            <SheetTitle id="create-agent-title">
              {step === 'mode' ? 'How will this agent connect?' : 'Name the agent'}
            </SheetTitle>
            <SheetDescription>
              {step === 'mode'
                ? 'Pick a path. Same agent identity, wallets, and policy either way.'
                : setupMode === 'mcp'
                  ? 'Then issue a credential and connect Cursor or Claude via MCP.'
                  : 'Then publish a public URL from the Arc nanopayments template.'}
            </SheetDescription>
          </div>
          <SheetCloseButton onClick={() => handleOpenChange(false)} />
        </SheetHeader>

        {step === 'mode' ? (
          <SheetBody>
            <div className="agent-setup-mode-grid" role="group" aria-label="Agent setup mode">
              <button className="agent-setup-mode-card" onClick={() => chooseMode('mcp')} type="button">
                <span className="agent-setup-mode-icon" aria-hidden="true">
                  <IconPlugConnected size={22} stroke={1.6} />
                </span>
                <strong>Connect via MCP</strong>
                <span>Use Cursor, Claude, or Codex with a hosted AgentOps credential. Policy gates every spend.</span>
              </button>
              <button className="agent-setup-mode-card" onClick={() => chooseMode('publish')} type="button">
                <span className="agent-setup-mode-icon" aria-hidden="true">
                  <IconWorldWww size={22} stroke={1.6} />
                </span>
                <strong>Publish Arc agent</strong>
                <span>
                  Fork{' '}
                  <span className="agent-setup-mode-repo">arc-nanopayments</span>
                  , host it, paste the URL, register ERC-8004 identity.
                </span>
              </button>
            </div>
            <p className="agent-setup-mode-footnote">
              Template repo:{' '}
              <a href={templateRepoUrl} rel="noreferrer" target="_blank">
                {templateRepoUrl.replace(/^https?:\/\//, '')}
              </a>
            </p>
          </SheetBody>
        ) : (
          <form action={formAction} className="focus-form">
            <SheetBody>
              <section className="agent-drawer-form-section">
                <h3>Identity</h3>
                <input name="setup_mode" type="hidden" value={setupMode ?? 'mcp'} />
                <label className="focus-field">
                  <span>Agent name</span>
                  <input aria-label="Agent name" autoComplete="off" name="name" placeholder="Research agent" required />
                  <small>Used across policies, approvals, and the publish listing.</small>
                </label>
              </section>
              {state.error !== undefined ? <p className="form-error" role="alert">{state.error}</p> : null}
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
        )}
      </Sheet>
    </>
  );
}
