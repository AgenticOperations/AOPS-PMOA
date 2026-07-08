import type { PolicyDecisionMatch, PolicyDecisionValue } from '../policy/types.js';

export type RuntimeActionSchema = {
  readonly action: string;
  readonly label: string;
  readonly description: string;
  readonly required: readonly string[];
  readonly optional: readonly string[];
  readonly example: Record<string, unknown>;
};

export type RuntimeOnboardResponse = {
  readonly agent: {
    readonly id: string;
    readonly name: string;
  };
  readonly connection: {
    readonly id: string;
  };
  readonly contractVersion: string;
  readonly runtime: {
    readonly checkEndpoint: '/v1/runtime/check';
    readonly enforcementMode: {
      readonly runtimeApi: 'advisory_when_called_directly';
      readonly mcp: 'mediated_when_agent_uses_agentops_mcp';
      readonly paymentSigning: 'hard_when_agentops_controls_signing';
    };
  };
  readonly parser: {
    readonly mode: 'deterministic_v1';
    readonly lowConfidenceBehavior: 'needs_more_info';
  };
  readonly actions: readonly RuntimeActionSchema[];
};

export type RuntimeCheckInput = {
  readonly intent?: string | undefined;
  readonly action?: string | undefined;
  readonly resource?: Record<string, unknown> | undefined;
  readonly payment?: Record<string, unknown> | undefined;
  readonly tool?: Record<string, unknown> | undefined;
  readonly context?: Record<string, unknown> | undefined;
};

export type RuntimeDecisionResponse = {
  readonly id: string | null;
  readonly decision: PolicyDecisionValue | 'needs_more_info';
  readonly reasonCode: string;
  readonly explanation: string;
  readonly matched: readonly PolicyDecisionMatch[];
  readonly approvalId: string | null;
  readonly missingFields: readonly string[];
  readonly normalized: {
    readonly action: string | null;
    readonly target: { readonly type: 'agent'; readonly id: string };
    readonly context: Record<string, unknown>;
  };
};
