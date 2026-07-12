---
created: 2026-07-11
project: agentOps
ecosystem: circle
tags: [deployment, testnet, circle, worker, security]
---

# Testnet Circle Worker Deployment

Backlinks: [[10-Projects/Web3-Builds/agentOps/HANDOFF]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/README]]

## Services

Deploy one image as three independently scaled services:

| Service | Command | Exposure |
|---|---|---|
| Web | `npm --workspace @agentops-pmoa/web run start` | Public |
| API | `npm --workspace @agentops-pmoa/api run start` | Public |
| Circle worker | `npm --workspace @agentops-pmoa/api run start:circle-worker` | Private network only |

Postgres is the authority for identity, policy, ledger, encrypted Circle profiles, and provider jobs. Redis is a cache and enforcement hot tier. The API calls the Circle worker over the deployment provider's private service network. The worker is the only process allowed to invoke the pinned `@circle-fin/cli` binary.

## Required Secrets

- `DATABASE_URL`: shared by API and Circle worker.
- `REDIS_URL`: API only.
- `CIRCLE_PROFILE_MASTER_KEY`: one random 32-byte key encoded as base64. Keep it on the Circle worker only; the public API has no local CLI fallback.
- `CIRCLE_WORKER_TOKEN`: random value of at least 32 characters, shared only by API and worker.
- `CIRCLE_WORKER_URL`: API-side private URL such as `http://circle-worker.internal:8090`.
- Google OAuth values and the normal application session configuration.

Do not put Circle OTP values, decrypted profile files, or worker secrets in logs, build arguments, frontend variables, or database plaintext columns.

## Worker Runtime

- Use Node `22.15.0` or newer. This satisfies the pinned Circle CLI and the application dependency graph.
- Mount no persistent home directory. Every organization command restores an encrypted allowlisted profile into a new temporary directory and deletes it after use.
- Keep `/tmp` writable. A memory-backed temporary filesystem is preferred.
- Do not install a desktop keychain service in the worker container. Session persistence is handled by the encrypted profile store.
- Expose `/healthz` to the platform health checker. All `/internal/circle/*` routes require the bearer worker token.
- Run one or more worker replicas. PostgreSQL advisory locks serialize commands per organization across replicas.

## Testnet-Only Guardrails

- The database constrains organization payment mode to `test`.
- Public mode mutation rejects `live`.
- Worker provider calls reject any payload whose mode is not `test`.
- Payment calls fail closed when no organization-scoped worker or encrypted connection is configured.
- An active Circle email can back only one organization in testnet.

## Release Gate

1. Run migrations before accepting traffic.
2. Verify API and worker use the same worker token and database.
3. Confirm API cannot reach a machine-global Circle session when worker configuration is absent.
4. Complete a fresh browser onboarding with OTP.
5. Restart the worker and verify the organization can still list its wallets.
6. Verify a second organization cannot read or execute with the first organization's profile.
7. Verify five chain wallets and ten payment sources exist, then exercise faucet, exact payment, Gateway payment, and rebalancing from the product UI.
