type RedactionResult = {
  readonly value: unknown;
  readonly redacted: boolean;
};

const REDACTED = '[REDACTED]';

const sensitiveKeyFragments = [
  'apikey',
  'authorization',
  'bearer',
  'circleapikey',
  'cookie',
  'credential',
  'password',
  'privatekey',
  'providerkey',
  'secret',
  'session',
  'signature',
  'token',
  'xpayment',
];

const sensitiveValuePatterns = [
  /\bbearer\s+[a-z0-9._~+/=-]+/i,
  /\bsk_(live|test|prod|dev)_[a-z0-9_]+/i,
  /\bagentops_session=/i,
  /\bx402[_:=.-]?[a-z0-9+/=-]*/i,
];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return sensitiveKeyFragments.some((fragment) => normalized.includes(fragment));
}

function isSensitiveString(value: string): boolean {
  return sensitiveValuePatterns.some((pattern) => pattern.test(value));
}

function redactValue(value: unknown, parentKey?: string): RedactionResult {
  if (parentKey !== undefined && isSensitiveKey(parentKey)) {
    return { value: REDACTED, redacted: true };
  }

  if (typeof value === 'string' && isSensitiveString(value)) {
    return { value: REDACTED, redacted: true };
  }

  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const result = redactValue(item);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value: next, redacted };
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    let redacted = false;
    const next: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      const result = redactValue(item, key);
      redacted ||= result.redacted;
      next[key] = result.value;
    }

    return { value: next, redacted };
  }

  return { value, redacted: false };
}

export function redactAuditPayload(value: unknown): RedactionResult {
  return redactValue(value);
}
