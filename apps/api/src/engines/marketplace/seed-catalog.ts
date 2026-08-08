import type { PaymentChain } from '../payments/types.js';

export type MarketplaceRail = 'x402' | 'escrow';

export type SeedMarketplaceService = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly endpointUrl: string;
  readonly chain: PaymentChain;
  readonly priceHint: string;
  readonly providerAddress: string | null;
  readonly rails: readonly MarketplaceRail[];
};

const TESTNET_X402_PAY_TO = '0x000000000000000000000000000000000000dEaD';

function apiBaseUrl(): string {
  const raw = process.env.AGENTOPS_PUBLIC_API_BASE_URL?.trim()
    || process.env.AGENTOPS_API_BASE_URL?.trim()
    || 'http://127.0.0.1:8080';
  return raw.replace(/\/+$/, '');
}

function demoHost(): string {
  return (process.env.MARKETPLACE_DEMO_HOST?.trim() || 'http://127.0.0.1').replace(/\/+$/, '');
}

/**
 * Curated demo/test x402 services shipped with AgentOps (fleet agents + weather fixtures).
 * Not Ampersend/Exa scrapes — our own endpoints for marketplace demos.
 */
export function seedMarketplaceServices(): readonly SeedMarketplaceService[] {
  const host = demoHost();
  const api = apiBaseUrl();
  const dataFetcherPort = process.env.DATA_FETCHER_PORT?.trim() || '4001';
  const analystPort = process.env.ANALYST_PORT?.trim() || '4002';
  const writerPort = process.env.WRITER_PORT?.trim() || '4003';
  const reviewerPort = process.env.SENIOR_REVIEWER_PORT?.trim() || '4004';

  const fleet: SeedMarketplaceService[] = [
    {
      id: 'svc_demo_data_fetcher',
      name: 'DataFetcher',
      category: 'Demo/Utility',
      description: 'Fleet demo market-data agent. Returns 402 then Arc USDC-paid payload on GET /data. Hire uses Permit2 when your org has a DataFetcher agent; start the seller on port 4001 (or via demo/run).',
      endpointUrl: `${host}:${dataFetcherPort}/data`,
      chain: 'arc',
      priceHint: '0.01 USDC',
      providerAddress: null,
      rails: ['x402'],
    },
    {
      id: 'svc_demo_analyst',
      name: 'Analyst',
      category: 'Demo/Utility',
      description: 'Fleet demo analysis agent with second-hop payment capability. GET /analysis.',
      endpointUrl: `${host}:${analystPort}/analysis`,
      chain: 'arc',
      priceHint: '0.05 USDC',
      providerAddress: null,
      rails: ['x402'],
    },
    {
      id: 'svc_demo_writer',
      name: 'Writer',
      category: 'Demo/Utility',
      description: 'Fleet demo report writer. GET /report after x402 payment.',
      endpointUrl: `${host}:${writerPort}/report`,
      chain: 'arc',
      priceHint: '0.02 USDC',
      providerAddress: null,
      rails: ['x402'],
    },
    {
      id: 'svc_demo_senior_reviewer',
      name: 'SeniorReviewer',
      category: 'Demo/Utility',
      description: 'Cross-chain fleet reviewer on Base Sepolia. GET /review.',
      endpointUrl: `${host}:${reviewerPort}/review`,
      chain: 'base',
      priceHint: '0.03 USDC',
      providerAddress: null,
      rails: ['x402'],
    },
  ];

  const weather: SeedMarketplaceService[] = [
    {
      id: 'svc_testnet_weather_base',
      name: 'Testnet Weather (Base)',
      category: 'Data/Search',
      description: 'AgentOps exact x402 weather fixture on Base Sepolia. Enable with ENABLE_TESTNET_X402_FIXTURES.',
      endpointUrl: `${api}/v1/testnet/x402/weather`,
      chain: 'base',
      priceHint: '0.01 USDC',
      providerAddress: TESTNET_X402_PAY_TO,
      rails: ['x402'],
    },
    {
      id: 'svc_testnet_weather_gateway_base',
      name: 'Testnet Weather Gateway (Base)',
      category: 'Data/Search',
      description: 'Gateway-backed weather fixture for x402 settlement demos.',
      endpointUrl: `${api}/v1/testnet/x402/gateway-weather`,
      chain: 'base',
      priceHint: '0.001 USDC',
      providerAddress: TESTNET_X402_PAY_TO,
      rails: ['x402'],
    },
    {
      id: 'svc_nanopayments_template',
      name: 'Arc Nanopayments Seller',
      category: 'Demo/Utility',
      description: 'Pointer to the Circle arc-nanopayments seller path. Host locally, then publish your agent URL.',
      endpointUrl: process.env.MARKETPLACE_NANOPAYMENTS_URL?.trim()
        || 'http://127.0.0.1:3000/api/protected',
      chain: 'arc',
      priceHint: 'varies',
      providerAddress: null,
      rails: ['x402'],
    },
  ];

  return [...fleet, ...weather];
}

export function seedServiceById(id: string): SeedMarketplaceService | null {
  return seedMarketplaceServices().find((service) => service.id === id) ?? null;
}
