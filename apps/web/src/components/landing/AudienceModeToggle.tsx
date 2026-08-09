'use client';

import type { LandingAudience } from './audience-mode';

type AudienceModeToggleProps = {
  readonly mode: LandingAudience;
  readonly onChange: (mode: LandingAudience) => void;
};

/**
 * Ampersand-style Human / Agent segmented control.
 * Agent mode swaps the landing surface to a structured MCP / llms.txt view.
 */
export function AudienceModeToggle({ mode, onChange }: AudienceModeToggleProps) {
  return (
    <div className="aops-audience-dock" role="group" aria-label="Landing audience">
      <div className="aops-audience-toggle">
        <button
          aria-pressed={mode === 'human'}
          className="aops-audience-option"
          data-active={mode === 'human'}
          onClick={() => onChange('human')}
          type="button"
        >
          Human
        </button>
        <button
          aria-pressed={mode === 'agent'}
          className="aops-audience-option"
          data-active={mode === 'agent'}
          onClick={() => onChange('agent')}
          type="button"
        >
          Agent
        </button>
      </div>
    </div>
  );
}
