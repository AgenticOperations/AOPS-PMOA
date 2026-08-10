# Security Policy

## Supported versions

agentOps PMOA is currently a **testnet-oriented** control plane. Security fixes
are applied on the `main` branch.

| Branch / release | Supported |
|---|---|
| `main` | Yes |
| Feature branches | Best effort |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Use one of these private channels instead:

1. [GitHub Security Advisories](https://github.com/AgenticOperations/AOPS-PMOA/security/advisories/new) (preferred)
2. Email the maintainers via the organization contact listed on the [AgenticOperations GitHub org](https://github.com/AgenticOperations)

Include:

- A clear description of the issue and impact
- Steps to reproduce or a proof of concept
- Affected commit / branch if known
- Whether the issue is already being exploited (if known)

Do **not** include production secrets, private keys, OTPs, or customer data in
the report beyond what is strictly necessary to demonstrate the issue.

## Response expectations

We aim to:

- Acknowledge valid reports within **3 business days**
- Provide an initial severity assessment within **7 business days**
- Coordinate a fix and disclosure timeline with the reporter

## Security scope (high priority)

Reports in these areas are especially valuable:

- Cross-tenant data exposure or authorization bypass
- Agent credential / bearer token leakage
- Circle worker / provider secret exposure to browser or public API
- Payment amount / budget / Permit2 / escrow bypass
- Privilege escalation across org roles
- Secret leakage via logs, CI artifacts, or error messages

## Out of scope (typical)

- Issues that require physical access to a developer machine
- Denial of service against local demo fixtures only
- Vulnerabilities in third-party services outside our control (report upstream when possible)
- Missing security headers on local-only development setups without a realistic exploit path

## Hardening practices in this repo

- Secrets belong in environment / deployment secret stores, never in git
- `.env.example` is the committed template; real `.env` files stay local
- CI runs `npm audit --audit-level=high`, CodeQL, secret scanning, and dependency review
- Payment and credential paths must keep provider secrets off the public web/API surfaces

Thank you for helping keep agentOps and its operators safe.
