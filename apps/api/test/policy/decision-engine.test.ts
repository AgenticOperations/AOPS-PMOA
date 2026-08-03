import { describe, expect, it } from 'vitest';
import { evaluatePolicyDecision, type PolicyStatement } from '../../src/engines/policy/decision-engine.js';

const baseStatement = {
  id: 'stmt_base',
  actions: ['management.connection.issue'],
  target: { types: ['agent'] },
  audit: 'standard',
} satisfies Omit<PolicyStatement, 'decision'>;

describe('Section 2 policy decision engine', () => {
  it('denies requests when no active policy statement matches', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [],
    });

    expect(result).toEqual({
      decision: 'deny',
      enforceability: 'enforceable',
      reasonCode: 'no_matching_policy_denied',
      explanation: 'No policy authorizes this request.',
      matched: [],
    });
  });

  it('allows unmatched requests when the org default is permissive', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [],
      defaultEffect: 'allow',
    });

    expect(result.decision).toBe('allow');
    expect(result.reasonCode).toBe('no_matching_policy');
    expect(result.matched).toEqual([]);
  });

  // TRAP GUARD: the fail-closed fix must branch on matched.length === 0, NOT
  // reseed the reduce. decisionRank is a max-severity fold, so a 'deny' seed
  // would beat every matching allow and deny the entire system.
  it('still allows when a matching statement says allow', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [
        {
          policyId: 'pol_allow',
          version: 1,
          name: 'Allow issue',
          statements: [{ ...baseStatement, id: 'stmt_allow', decision: 'allow' }],
        },
      ],
    });

    expect(result.decision).toBe('allow');
    expect(result.reasonCode).toBe('no_matching_policy');
    expect(result.matched).toHaveLength(1);
  });

  // TRAP GUARD: the max-rank fold must remain intact.
  it('prefers deny over allow when both match', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [
        {
          policyId: 'pol_mixed',
          version: 1,
          name: 'Mixed',
          statements: [
            { ...baseStatement, id: 'stmt_allow', decision: 'allow' },
            { ...baseStatement, id: 'stmt_deny', decision: 'deny' },
          ],
        },
      ],
    });

    expect(result.decision).toBe('deny');
  });

  // A permissive org default must not weaken authored rules.
  it('keeps a matching deny even when the org default is permissive', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_owner', role: 'owner' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [
        {
          policyId: 'pol_deny',
          version: 1,
          name: 'Deny issue',
          statements: [{ ...baseStatement, id: 'stmt_deny', decision: 'deny' }],
        },
      ],
      defaultEffect: 'allow',
    });

    expect(result.decision).toBe('deny');
  });

  it('uses the most restrictive matching decision across effective policies', () => {
    const statements: PolicyStatement[] = [
      {
        ...baseStatement,
        id: 'stmt_observe',
        decision: 'observe',
      },
      {
        ...baseStatement,
        id: 'stmt_deny',
        decision: 'deny',
      },
      {
        ...baseStatement,
        id: 'stmt_approval',
        decision: 'approval_required',
      },
    ];

    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_operator', role: 'operator' },
        action: 'management.connection.issue',
        target: { type: 'agent', id: 'agt_1' },
        context: {},
      },
      policies: [
        {
          policyId: 'pol_controls',
          version: 1,
          name: 'Credential controls',
          statements,
        },
      ],
    });

    expect(result.decision).toBe('deny');
    expect(result.reasonCode).toBe('policy_denied');
    expect(result.matched.map((match) => match.statementId)).toEqual([
      'stmt_observe',
      'stmt_deny',
      'stmt_approval',
    ]);
  });

  it('matches actor roles, actions, target types, and target ids', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'user', id: 'usr_operator', role: 'operator' },
        action: 'management.agent.pause',
        target: { type: 'agent', id: 'agt_allowed' },
        context: {},
      },
      policies: [
        {
          policyId: 'pol_agent_control',
          version: 1,
          name: 'Agent controls',
          statements: [
            {
              id: 'stmt_wrong_action',
              decision: 'deny',
              actions: ['management.connection.issue'],
              target: { types: ['agent'], ids: ['agt_allowed'] },
              audit: 'standard',
            },
            {
              id: 'stmt_wrong_target',
              decision: 'deny',
              actions: ['management.agent.pause'],
              target: { types: ['agent'], ids: ['agt_other'] },
              audit: 'standard',
            },
            {
              id: 'stmt_matching_role',
              decision: 'approval_required',
              actions: ['management.agent.pause'],
              actor: { roles: ['operator'] },
              target: { types: ['agent'], ids: ['agt_allowed'] },
              audit: 'detailed',
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      decision: 'approval_required',
      reasonCode: 'policy_requires_approval',
      explanation: 'A policy requires approval before this request can continue.',
    });
    expect(result.matched).toEqual([
      {
        policyId: 'pol_agent_control',
        policyVersion: 1,
        policyName: 'Agent controls',
        statementId: 'stmt_matching_role',
        decision: 'approval_required',
      },
    ]);
  });

  it('matches structured resource, payment, and tool conditions', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'connection', id: 'conn_research' },
        action: 'payment.x402.authorize',
        target: { type: 'agent', id: 'agt_research' },
        context: {
          resource: {
            category: 'market-data',
            domain: 'paid.example.test',
          },
          payment: {
            amount: '2.50',
            asset: 'USDC',
            network: 'base',
            recipient: '0xRecipient',
          },
          tool: {
            name: 'agentops.paid_fetch',
            riskLevel: 'medium',
          },
        },
      },
      policies: [
        {
          policyId: 'pol_runtime_controls',
          version: 1,
          name: 'Runtime controls',
          statements: [
            {
              id: 'stmt_wrong_category',
              decision: 'deny',
              actions: ['payment.x402.authorize'],
              target: { types: ['agent'], ids: ['agt_research'] },
              conditions: {
                resource: { categories: ['weather'] },
              },
              audit: 'standard',
            },
            {
              id: 'stmt_paid_market_data_needs_approval',
              decision: 'approval_required',
              actions: ['payment.x402.authorize'],
              target: { types: ['agent'], ids: ['agt_research'] },
              conditions: {
                resource: { categories: ['market-data'], domains: ['paid.example.test'] },
                payment: {
                  minAmount: '1.00',
                  assets: ['USDC'],
                  networks: ['base'],
                  recipients: ['0xRecipient'],
                },
                tool: {
                  names: ['agentops.paid_fetch'],
                  riskLevels: ['medium'],
                },
              },
              audit: 'detailed',
            },
          ],
        },
      ],
    });

    expect(result.decision).toBe('approval_required');
    expect(result.matched.map((match) => match.statementId)).toEqual(['stmt_paid_market_data_needs_approval']);
  });

  it('supports wildcard action policies for allowlist-style defaults', () => {
    const result = evaluatePolicyDecision({
      request: {
        actor: { type: 'connection', id: 'conn_research' },
        action: 'runtime.http.request',
        target: { type: 'agent', id: 'agt_research' },
        context: {
          resource: {
            category: 'weather',
            domain: 'api.weather.example',
          },
        },
      },
      policies: [
        {
          policyId: 'pol_block_weather',
          version: 1,
          name: 'Block weather',
          statements: [
            {
              id: 'stmt_block_weather_any_action',
              decision: 'deny',
              actions: ['*'],
              target: { types: ['agent'], ids: ['agt_research'] },
              conditions: {
                resource: { categories: ['weather'] },
              },
              audit: 'detailed',
            },
          ],
        },
      ],
    });

    expect(result).toMatchObject({
      decision: 'deny',
      reasonCode: 'policy_denied',
    });
  });
});
