'use client';

import { CHAIN_LABELS } from '@/lib/payments-format';
import { CopyableAddress } from './CopyableAddress';
import type { AgentWalletFundingRecord } from '@/lib/server/payments-client';
import type { CircleChainWalletRecord } from '@/lib/payments-types';

type Props = {
  readonly treasuryWallets: readonly CircleChainWalletRecord[];
  readonly agentWallets: readonly AgentWalletFundingRecord[];
};

function usdc(micros: string | null): string {
  if (micros === null) return '—';
  const value = BigInt(micros);
  return `${(value / 1_000_000n).toString()}.${(value % 1_000_000n).toString().padStart(6, '0').slice(0, 2)}`;
}

/**
 * The funding hierarchy, top to bottom:
 *
 *   org treasury  ->  agent wallet  ->  the agent spending it
 *
 * Each tier shows the address to send funds to, because none of them were
 * reachable from the console before -- agent wallet addresses were not
 * exposed over HTTP at all.
 */
export function FundingHierarchy({ treasuryWallets, agentWallets }: Props) {
  const fundedChains = treasuryWallets.filter((wallet) => wallet.status === 'active');

  return (
    <div className="grid gap-6">
      <section className="rounded-lg border p-4">
        <header className="mb-3">
          <h2 className="font-medium">1 · Org treasury</h2>
          <p className="text-sm text-muted-foreground">
            Send test USDC here to fund the fleet. Each chain has its OWN treasury address — they
            are created independently, so send to the row for the chain your agents operate on.
          </p>
        </header>
        {fundedChains.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No treasury yet. Finish workspace setup to provision one.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2 font-medium">Chain</th>
                <th className="p-2 font-medium">Deposit address</th>
              </tr>
            </thead>
            <tbody>
              {fundedChains.map((wallet) => (
                <tr key={`${wallet.chain}-${wallet.address}`} className="border-b last:border-0">
                  <td className="p-2">{CHAIN_LABELS[wallet.chain] ?? wallet.chain}</td>
                  <td className="p-2"><CopyableAddress address={wallet.address} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <header className="mb-3">
          <h2 className="font-medium">2 · Agent wallets</h2>
          <p className="text-sm text-muted-foreground">
            Topped up from the treasury against each agent&apos;s delegation ceiling. This is the
            balance an agent actually spends from. Unlike the treasury, an agent keeps one address
            shared across chains.
          </p>
        </header>
        {agentWallets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agent wallets yet. Grant an agent payment access to provision one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2 font-medium">Agent</th>
                  <th className="p-2 font-medium">Chain</th>
                  <th className="p-2 font-medium">Address</th>
                  <th className="p-2 font-medium">Balance</th>
                  <th className="p-2 font-medium">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {agentWallets.map((wallet) => (
                  <tr key={`${wallet.agentId}-${wallet.chain}`} className="border-b last:border-0">
                    <td className="p-2">{wallet.agentName}</td>
                    <td className="p-2">{CHAIN_LABELS[wallet.chain] ?? wallet.chain}</td>
                    <td className="p-2"><CopyableAddress address={wallet.address} /></td>
                    <td className="p-2">{usdc(wallet.usdcMicros)}</td>
                    <td className="p-2">
                      {wallet.allocatedUsdc === null
                        ? <span className="text-muted-foreground">not allocated</span>
                        : wallet.allocatedUsdc}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {agentWallets.some((wallet) => wallet.chain === 'base') ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Base agents also need a little ETH for gas — USDC alone is not enough there. Arc needs
            none, because its gas asset is USDC.
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border p-4">
        <header>
          <h2 className="font-medium">3 · Your fleet</h2>
          <p className="text-sm text-muted-foreground">
            Agents spend from their own wallet, within the cap you set. Nothing they do can exceed
            it, and you can revoke at any time.
          </p>
        </header>
      </section>
    </div>
  );
}
