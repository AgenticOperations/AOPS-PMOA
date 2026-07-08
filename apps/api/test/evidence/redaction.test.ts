import { describe, expect, it } from 'vitest';
import { redactAuditPayload } from '../../src/engines/evidence/redaction.js';

describe('redactAuditPayload', () => {
  it('recursively redacts secret-bearing keys and values', () => {
    const result = redactAuditPayload({
      authorization: 'Bearer sk_live_secret',
      cookie: 'agentops_session=session_secret',
      nested: {
        circleApiKey: 'circle_secret',
        private_key: '0xabc',
        xPayment: 'x402_payload',
        safe: 'keep-me',
      },
      list: [{ signature: 'sig_secret' }, 'Bearer another_secret'],
    });

    expect(result.redacted).toBe(true);
    expect(result.value).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      nested: {
        circleApiKey: '[REDACTED]',
        private_key: '[REDACTED]',
        xPayment: '[REDACTED]',
        safe: 'keep-me',
      },
      list: [{ signature: '[REDACTED]' }, '[REDACTED]'],
    });
  });

  it('reports unredacted state when the payload has no sensitive material', () => {
    const result = redactAuditPayload({
      action: 'policy.create',
      amount: '10.00',
      nested: [{ safe: true }],
    });

    expect(result.redacted).toBe(false);
    expect(result.value).toEqual({
      action: 'policy.create',
      amount: '10.00',
      nested: [{ safe: true }],
    });
  });
});
