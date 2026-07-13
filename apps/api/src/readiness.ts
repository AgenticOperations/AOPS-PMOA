export type ReadinessCheck = () => Promise<unknown>;

export function createReadinessProbe(
  checks: readonly ReadinessCheck[],
): () => Promise<boolean> {
  return async () => {
    try {
      await Promise.all(checks.map((check) => check()));
      return true;
    } catch {
      return false;
    }
  };
}

export function createHttpReadinessCheck(options: {
  readonly headers?: Readonly<Record<string, string>>;
  readonly request?: typeof fetch;
  readonly timeoutMs: number;
  readonly url: string;
}): ReadinessCheck {
  const request = options.request ?? fetch;
  return async () => {
    const response = await request(options.url, {
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      method: 'GET',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) throw new Error('dependency_not_ready');
  };
}
