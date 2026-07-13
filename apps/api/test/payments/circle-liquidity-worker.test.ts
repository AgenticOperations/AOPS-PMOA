import { describe, expect, it, vi } from 'vitest';
import {
  classifyCircleWorkerJob,
  gatewayDepositSatisfied,
  resolveGatewayDepositorAddress,
  runCircleLiquidityWorkerPass,
} from '../../src/engines/payments/circle-liquidity-worker.js';

describe('Circle liquidity worker', () => {
  it('routes liquidity jobs to retry and submitted provider jobs to reconciliation', () => {
    expect(classifyCircleWorkerJob({ jobType: 'liquidity.prepare', status: 'queued' })).toBe('retry_liquidity');
    expect(classifyCircleWorkerJob({ jobType: 'liquidity.prepare', status: 'submitted' })).toBe('retry_liquidity');
    expect(classifyCircleWorkerJob({ jobType: 'gateway.deposit', status: 'submitted' })).toBe('reconcile_provider');
    expect(classifyCircleWorkerJob({ jobType: 'wallet.rebalance', status: 'submitted' })).toBe('reconcile_provider');
    expect(classifyCircleWorkerJob({ jobType: 'gateway.deposit', status: 'failed' })).toBe('reconcile_provider');
    expect(classifyCircleWorkerJob({ jobType: 'gateway.deposit', status: 'complete' })).toBeNull();
  });

  it('requires a repeated Gateway deposit to increase the pre-deposit balance', () => {
    expect(gatewayDepositSatisfied({ amountMicros: 500000n, beforeMicros: 500000n, observedMicros: 500000n })).toBe(false);
    expect(gatewayDepositSatisfied({ amountMicros: 500000n, beforeMicros: 500000n, observedMicros: 1000000n })).toBe(true);
    expect(gatewayDepositSatisfied({ amountMicros: 500000n, beforeMicros: null, observedMicros: 500000n })).toBe(true);
  });

  it('uses the persisted Circle backing depositor for Gateway balance reads', () => {
    expect(resolveGatewayDepositorAddress('0xsca', {
      gateway_depositor_address: '0xbacking',
    })).toBe('0xbacking');
    expect(resolveGatewayDepositorAddress('0xsca', {})).toBe('0xsca');
  });

  it('processes queued liquidity jobs in order without stopping after one job fails', async () => {
    const jobs = [
      { id: 'cjob_first', orgId: 'org_one' },
      { id: 'cjob_second', orgId: 'org_two' },
      { id: 'cjob_third', orgId: 'org_three' },
    ];
    const processJob = vi.fn((job: (typeof jobs)[number]) => {
      if (job.id === 'cjob_second') return Promise.reject(new Error('provider unavailable'));
      return Promise.resolve();
    });
    const onError = vi.fn();
    const purgeExpiredResults = vi.fn(() => Promise.resolve(0));

    const processed = await runCircleLiquidityWorkerPass({
      listJobs: () => Promise.resolve(jobs),
      onError,
      processJob,
      purgeExpiredResults,
    });

    expect(processJob.mock.calls.map(([job]) => job.id)).toEqual([
      'cjob_first',
      'cjob_second',
      'cjob_third',
    ]);
    expect(onError).toHaveBeenCalledWith(jobs[1], expect.any(Error));
    expect(purgeExpiredResults).toHaveBeenCalledOnce();
    expect(processed).toBe(2);
  });

  it('runs expired-result maintenance once even when there are no Circle jobs', async () => {
    const purgeExpiredResults = vi.fn(() => Promise.resolve(7));

    const processed = await runCircleLiquidityWorkerPass({
      listJobs: () => Promise.resolve([]),
      onError: vi.fn(),
      processJob: vi.fn(),
      purgeExpiredResults,
    });

    expect(purgeExpiredResults).toHaveBeenCalledOnce();
    expect(processed).toBe(0);
  });
});
