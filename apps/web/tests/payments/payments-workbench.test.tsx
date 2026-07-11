import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PaymentsWorkbench } from '../../src/components/payments/PaymentsWorkbench.js';

const agent = {
  id: 'agt_trade',
  name: 'Trade research agent',
  status: 'active' as const,
  labels: [],
  team: { id: 'team_default', name: 'Default' },
  connection_health: 'healthy' as const,
  wallet_refs_count: 0,
  policy_coverage: 0,
  last_activity_at: null,
};

describe('PaymentsWorkbench', () => {
  it('renders Base Gateway source state and explicit agent payment access', () => {
    render(
      <PaymentsWorkbench
        accessAction={async () => {}}
        agents={[agent]}
        agentPayments={[
          {
            agent,
            account: {
              id: 'payacct_1',
              org_id: 'org_1',
              agent_id: agent.id,
              status: 'active',
              payment_access: true,
              budget_usdc: '5.00',
              spent_usdc: '1.25',
              reserved_usdc: '0.00',
              per_request_cap_usdc: '2.00',
              approval_threshold_usdc: null,
              dedicated_wallet_required: false,
              allowed_rails: ['gateway_base'],
              created_at: '2026-07-08T08:00:00.000Z',
              updated_at: '2026-07-08T08:00:00.000Z',
            },
          },
        ]}
        bridgeTopUpAction={async () => {}}
        cancelLiquidityJobAction={async () => {}}
        sourceAction={async () => {}}
        circleTreasuryAction={async () => {}}
        modeAction={async () => {}}
        paymentMode={{
          mode: 'test',
          org_id: 'org_1',
          updated_at: '2026-07-08T08:00:00.000Z',
          updated_by: 'usr_owner',
        }}
        providerHealth={{
          configured: true,
          missing: [],
          mode: 'test',
          provider: 'circle',
        }}
        rebalanceRecommendations={[
          {
            amount_usdc: '0.05',
            chain: 'arbitrum',
            current_wallet_usdc: '0.00',
            deficit_usdc: '0.05',
            reason_code: 'exact_wallet_below_recent_demand_floor',
            recent_exact_spend_usdc: '0.01',
            recommended_min_usdc: '0.05',
            source_chain: 'base',
          },
        ]}
        circleBalances={[
          {
            address: '0xbase000000000000000000000000000000000000',
            chain: 'base',
            circle_wallet_id: 'circle_wallet_test_base',
            gateway: {
              available: '98.75',
              domain: 7,
              total: '98.75',
              withdrawable: '98.75',
              withdrawing: '0',
            },
            mode: 'test',
            tokens: [
              {
                amount: '12.00',
                blockchain: 'BASE-SEPOLIA',
                is_native: false,
                symbol: 'USDC',
                token_address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
              },
            ],
          },
        ]}
        circleJobs={[
          {
            amount_usdc: null,
            chain: 'base',
            created_at: '2026-07-08T09:00:00.000Z',
            error_code: 'API rate limit error',
            id: 'cjob_faucet',
            job_type: 'wallet.faucet',
            metadata: {},
            mode: 'test',
            org_id: 'org_1',
            provider_ref: null,
            status: 'failed',
            updated_at: '2026-07-08T09:00:00.000Z',
          },
        ]}
        liquidityJobs={[
          {
            amount_usdc: '0.50',
            chain: 'arbitrum',
            created_at: '2026-07-08T10:00:00.000Z',
            error_code: null,
            id: 'cjob_prepare',
            job_type: 'liquidity.prepare',
            metadata: {
              destination_bucket: 'gateway:arbitrum',
              rail: 'gateway_arbitrum',
              source_bucket: 'wallet:base',
            },
            mode: 'test',
            org_id: 'org_1',
            provider_ref: null,
            status: 'queued',
            updated_at: '2026-07-08T10:00:00.000Z',
          },
        ]}
        paymentEvents={[
          {
            id: 'payevt_1',
            org_id: 'org_1',
            agent_id: agent.id,
            connection_id: 'conn_1',
            source_id: 'paysrc_1',
            reservation_id: 'payres_1',
            decision: 'submitted',
            provider_mode: 'test',
            rail: 'gateway_base',
            chain: 'base',
            amount_usdc: '1.25',
            asset: 'USDC',
            recipient: '0x000000000000000000000000000000000000dEaD',
            network: 'eip155:84532',
            resource_url: 'https://seller.example.test/weather',
            resource_category: 'weather',
            quote: {},
            result: {},
            activity_id: 'act_1',
            created_at: '2026-07-08T11:00:00.000Z',
          },
        ]}
        paymentReservations={[
          {
            id: 'payres_1',
            org_id: 'org_1',
            agent_id: agent.id,
            connection_id: 'conn_1',
            source_id: 'paysrc_1',
            amount_usdc: '1.25',
            asset: 'USDC',
            rail: 'gateway_base',
            status: 'settled',
            reason_code: 'submitted',
            quote_hash: 'abcdef1234567890',
            quote: {},
            expires_at: '2026-07-08T11:15:00.000Z',
            created_at: '2026-07-08T11:00:00.000Z',
            updated_at: '2026-07-08T11:00:00.000Z',
          },
        ]}
        railReadiness={[
          {
            rail: 'gateway_base',
            chain: 'base',
            rail_type: 'gateway',
            supported: true,
            settlement_verified: true,
            status: 'ready',
            reason: 'gateway_base has a verified settlement path for test mode.',
            last_observed_at: '2026-07-08T11:00:00.000Z',
            last_payment_at: '2026-07-08T11:00:00.000Z',
            last_proof_at: '2026-07-08T11:00:00.000Z',
            last_proof_status: 'complete',
          },
          {
            rail: 'gateway_arbitrum',
            chain: 'arbitrum',
            rail_type: 'gateway',
            supported: true,
            settlement_verified: false,
            status: 'unverified',
            reason: 'gateway_arbitrum liquidity can be prepared, but settlement still needs a successful testnet proof.',
            last_observed_at: null,
            last_payment_at: null,
            last_proof_at: '2026-07-08T11:10:00.000Z',
            last_proof_status: 'submitted',
          },
        ]}
        routeObservations={[
          {
            id: 'payobs_1',
            org_id: 'org_1',
            agent_id: agent.id,
            connection_id: 'conn_1',
            requested_network: 'eip155:84532',
            requested_asset: 'USDC',
            requested_rail: 'gateway_base',
            supported_rail: 'gateway_base',
            amount_usdc: '1.25',
            outcome: 'accepted',
            reason_code: 'submitted',
            resource_url: 'https://seller.example.test/weather',
            resource_category: 'weather',
            observed_at: '2026-07-08T11:00:00.000Z',
          },
        ]}
        circleWallets={[]}
        capabilities={[
          {
            chain: 'base',
            circle_blockchain: 'BASE-SEPOLIA',
            exact_settlement_verified: true,
            gateway_domain: 6,
            gateway_settlement_verified: true,
            gateway_supported: true,
            id: 'cap_base',
            mode: 'test',
            nanopayments_supported: true,
            network_label: 'Base Sepolia',
            status: 'active',
            wallet_account_type: 'sca',
            wallet_supported: true,
          },
        ]}
        sources={[
          {
            id: 'paysrc_1',
            org_id: 'org_1',
            treasury_id: 'trs_1',
            source_type: 'gateway',
            provider: 'circle_gateway',
            rail: 'gateway_base',
            chain: 'base',
            label: 'Base Gateway source',
            status: 'active',
            account_type: 'sca',
            address: null,
            external_wallet_id: null,
            simulated_balance_usdc: '98.75',
            metadata: {},
            created_at: '2026-07-08T08:00:00.000Z',
            updated_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        treasuries={[
          {
            id: 'trs_1',
            org_id: 'org_1',
            treasury_type: 'gateway',
            provider: 'circle_gateway',
            chain: 'base',
            label: 'Base Gateway treasury',
            status: 'active',
            metadata: {},
            created_at: '2026-07-08T08:00:00.000Z',
            updated_at: '2026-07-08T08:00:00.000Z',
          },
        ]}
        treasuryAction={async () => {}}
        treasuryOverview={{
          liquidity: {
            failed_jobs: 0,
            last_job: {
              amount_usdc: '0.50',
              chain: 'arbitrum',
              created_at: '2026-07-08T10:00:00.000Z',
              error_code: null,
              id: 'cjob_prepare',
              job_type: 'liquidity.prepare',
              metadata: {},
              mode: 'test',
              org_id: 'org_1',
              provider_ref: null,
              status: 'queued',
              updated_at: '2026-07-08T10:00:00.000Z',
            },
            pending_jobs: 1,
          },
          mode: 'test',
          payments: {
            agents_with_access: 1,
            last_payment: {
              amount: '1.25',
              created_at: '2026-07-08T11:00:00.000Z',
              rail: 'gateway_base',
            },
            total_spent_usdc: '1.25',
          },
          totals: {
            gateway_usdc: '98.75',
            treasury_usdc: '110.75',
            wallet_usdc: '12.00',
          },
        }}
        retryLiquidityJobAction={async () => {}}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Treasury' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workspace treasury' })).toBeInTheDocument();
    expect(screen.getByText('110.75 USDC')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Liquidity preparation' })).toBeInTheDocument();
    expect(screen.getByText('wallet:base -> gateway:arbitrum')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Advanced diagnostics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Provider mode' })).toBeInTheDocument();
    expect(screen.getAllByText('Test mode')[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sync Agent Wallet' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Payment rails' })).toBeInTheDocument();
    expect(screen.getAllByText('Base Gateway treasury')[0]).toBeInTheDocument();
    expect(screen.getByText('Base Gateway source')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rail readiness' })).toBeInTheDocument();
    expect(screen.getAllByText('gateway_base has a verified settlement path for test mode.')[0]).toBeInTheDocument();
    expect(screen.getByText('Submitted')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Route observations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payment ledger' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reservations' })).toBeInTheDocument();
    expect(screen.getAllByText('submitted').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('98.75 USDC').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('heading', { name: 'Provider jobs' })).toBeInTheDocument();
    expect(screen.getByText('Wallet Faucet')).toBeInTheDocument();
    expect(screen.getByText('API rate limit error')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Exact wallet top-up' })).toBeInTheDocument();
    expect(screen.getByText('0.01 USDC recent exact spend')).toBeInTheDocument();
    expect(screen.getAllByText('Trade research agent')).toHaveLength(2);
    expect(screen.getByText('5.00 USDC')).toBeInTheDocument();
    expect(screen.getAllByText('1.25 USDC').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Save access' })).toBeInTheDocument();
    expect(screen.queryByText(/Simulation source/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Local fallback/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/native gas/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/EOA/i)).not.toBeInTheDocument();
  });
});
