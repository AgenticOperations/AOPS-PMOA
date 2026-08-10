# CI and repository standards

This document summarizes the automated gates and GitHub community files for
`AgenticOperations/AOPS-PMOA`.

## Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | PR + push to `main` | Lint, typecheck, test, build |
| [`.github/workflows/security.yml`](../.github/workflows/security.yml) | PR + push to `main` + weekly | `npm audit` (high+), Gitleaks, CodeQL |
| [`.github/workflows/dependency-review.yml`](../.github/workflows/dependency-review.yml) | PR to `main` | Block high-severity / GPL-family deps |

Local equivalent:

```bash
npm run ci
```

API tests use Testcontainers (`postgres:16-alpine`), so Docker must be available
in CI and locally for `npm test`.

`npm audit --audit-level=high` is the security gate. Moderate advisories currently
remain in the Circle CLI / Solana / Hono transitive chain and do not fail CI; do
not use `npm audit fix --force` without re-running payment-provider regressions.

## Community / GitHub standards

| File | Role |
|---|---|
| `LICENSE` | MIT |
| `NOTICE.md` | Third-party / vendored license notes |
| `CONTRIBUTING.md` | How to contribute |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 |
| `SECURITY.md` | Private vulnerability reporting |
| `.github/pull_request_template.md` | PR checklist |
| `.github/ISSUE_TEMPLATE/*` | Bug / feature forms |
| `.github/CODEOWNERS` | Review routing |
| `.github/dependabot.yml` | Weekly npm / Actions / Docker updates |
| `.gitleaks.toml` | Secret-scan allowlist for known fixtures |
| `.nvmrc` | Node 22 |

## Recommended branch protection (`main`)

Enable in GitHub settings (Settings → Branches → Branch protection rules):

1. Require a pull request before merging
2. Require status checks:
   - `Lint`
   - `Typecheck`
   - `Test`
   - `Build`
   - `npm audit`
   - `Secret scan`
   - `CodeQL`
   - `Dependency review` (PRs)
3. Require conversation resolution before merging
4. Do not allow force pushes or deletions on `main`

CodeQL and Dependency Review also need GitHub Advanced Security / code scanning
enabled for the repository (public repos include these capabilities).
