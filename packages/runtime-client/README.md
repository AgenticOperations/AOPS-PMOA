# AgentOps thin runtime client

Minimal HTTP client for agent credentials against `/v1/runtime/...`.

This is **not** a Circle wallets, x402, or Gateway SDK. Use Circle packages for those rails; use this only to call AgentOps policy + payment orchestration from Node templates (e.g. the [arc-nanopayments overlay](../../templates/arc-nanopayments-agentops)).

```ts
import { RuntimeApiClient } from '@agentops-pmoa/runtime-client';

const client = new RuntimeApiClient({
  apiBaseUrl: process.env.AGENTOPS_API_BASE_URL!,
  credential: process.env.AGENTOPS_AGENT_CREDENTIAL!,
  timeoutMs: 60_000,
});

await client.check({ intent: 'payment' });
await client.paymentX402({ /* ... */ });
```
