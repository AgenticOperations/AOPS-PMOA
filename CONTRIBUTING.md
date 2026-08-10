# Contributing to agentOps PMOA

Thanks for contributing. This repo is the clean PMOA rebuild of agentOps
(`AgenticOperations/AOPS-PMOA`). The current release is intentionally
**testnet-oriented**.

## Before you start

1. Read [README.md](README.md) for setup and architecture.
2. Skim [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md) for product boundaries.
3. Check [SECURITY.md](SECURITY.md) before touching auth, payments, credentials, or CI secrets.
4. Review [NOTICE.md](NOTICE.md) before adding dependencies or vendored code.

## Development setup

Requirements: Node.js `>= 22.13.0`, npm, Docker Desktop (Compose v2) for local Postgres/Redis.

```bash
git clone https://github.com/AgenticOperations/AOPS-PMOA.git
cd AOPS-PMOA
npm run setup
```

Useful commands:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify   # lint + typecheck + build + test
npm run audit    # fail on high/critical advisories
```

## Branching and pull requests

1. Create a branch from `main`:
   - `feat/...` for features
   - `fix/...` for bug fixes
   - `chore/...` for tooling / deps
   - `docs/...` for documentation
2. Keep PRs focused. Prefer small, reviewable diffs over large mixed changes.
3. Fill out the pull request template completely.
4. Ensure CI is green before requesting review:
   - Lint
   - Typecheck
   - Test
   - Build
   - Security (audit / CodeQL / secret scan / dependency review on PRs)

### Commit style

Use concise, imperative commit messages. Conventional prefixes are welcome:

- `feat:` new behavior
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` no intended behavior change
- `chore:` maintenance, CI, deps
- `security:` hardening or vulnerability fixes

### PR expectations

- Describe **why**, not only what changed
- Include a test plan with commands you ran
- Update docs when setup, APIs, or operator flows change
- Call out breaking changes explicitly
- Never commit secrets, private keys, OTPs, wallet mnemonics, or real `.env` files

## Code quality bar

- TypeScript across apps/packages; keep types honest
- Prefer small modules with clear boundaries (`apps/*`, `packages/*`)
- Preserve tenant isolation and least-privilege authZ on every new route/action
- Do not move Circle provider secrets, profile encryption keys, or OTPs into the browser or public API
- Add or update tests next to the behavior you change when practical

## Security contributions

- Report vulnerabilities privately per [SECURITY.md](SECURITY.md)
- For hardening PRs, explain the threat model and residual risk
- New dependencies should prefer MIT / Apache-2.0 / BSD / ISC licenses
- Avoid GPL / AGPL dependencies unless maintainers explicitly approve

## Issues

- Use the Bug report or Feature request templates
- Search existing issues and `docs/features-to-discuss-later.md` first
- Security issues must use private reporting, not public issues

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
