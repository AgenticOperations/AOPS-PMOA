export type CircleLiquidityJobCandidate = {
  readonly id: string;
  readonly orgId: string;
};

export type CircleWorkerJobAction = 'reconcile_provider' | 'retry_liquidity';

export function gatewayDepositSatisfied(input: {
  readonly amountMicros: bigint;
  readonly beforeMicros: bigint | null;
  readonly observedMicros: bigint;
}): boolean {
  const requiredMicros = input.beforeMicros === null
    ? input.amountMicros
    : input.beforeMicros + input.amountMicros;
  return input.observedMicros >= requiredMicros;
}

export function resolveGatewayDepositorAddress(walletAddress: string, metadata: unknown): string {
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const value = (metadata as Record<string, unknown>).gateway_depositor_address;
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return walletAddress;
}

export function classifyCircleWorkerJob(input: {
  readonly jobType: string;
  readonly status: string;
}): CircleWorkerJobAction | null {
  if (input.jobType === 'liquidity.prepare' && (input.status === 'queued' || input.status === 'submitted')) {
    return 'retry_liquidity';
  }
  if (
    (input.jobType === 'gateway.deposit' || input.jobType === 'wallet.rebalance') &&
    (input.status === 'submitted' || input.status === 'failed')
  ) {
    return 'reconcile_provider';
  }
  return null;
}

export type CircleLiquidityWorkerDeps = {
  readonly listJobs: () => Promise<readonly CircleLiquidityJobCandidate[]>;
  readonly onError: (job: CircleLiquidityJobCandidate, error: unknown) => void;
  readonly processJob: (job: CircleLiquidityJobCandidate) => Promise<void>;
  readonly purgeExpiredResults: () => Promise<number>;
};

export async function runCircleLiquidityWorkerPass(deps: CircleLiquidityWorkerDeps): Promise<number> {
  const jobs = await deps.listJobs();
  let processed = 0;
  for (const job of jobs) {
    try {
      await deps.processJob(job);
      processed += 1;
    } catch (error) {
      deps.onError(job, error);
    }
  }
  await deps.purgeExpiredResults();
  return processed;
}

export function startCircleLiquidityWorker(
  deps: CircleLiquidityWorkerDeps,
  pollMs: number,
): () => void {
  let stopped = false;
  let timeout: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timeout = setTimeout(() => void tick(), pollMs);
    timeout.unref();
  };
  const tick = async (): Promise<void> => {
    try {
      await runCircleLiquidityWorkerPass(deps);
    } catch (error) {
      deps.onError({ id: 'worker-pass', orgId: 'system' }, error);
    } finally {
      schedule();
    }
  };

  void tick();
  return () => {
    stopped = true;
    if (timeout !== undefined) clearTimeout(timeout);
  };
}
