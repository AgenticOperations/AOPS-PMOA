---
created: 2026-07-07
project: agentOps
ecosystem: circle
tags: [section-0, error-log, build-pmoa, baseline]
---

# Error Log - Section 0 BUILD-PMOA Baseline

Backlinks: [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/section-0-build-pmoa-baseline]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/build-till-now/README]]

## Errors And Fixes

| Issue | Cause | Fix | Status |
|---|---|---|---|
| Initial dependency install required network access | Sandbox network restrictions blocked normal package download | Reran install with approved network escalation | Fixed |
| Dependency audit reported PostCSS issue | Transitive dependency version needed pinning | Added PostCSS override and dedupe | Fixed |
| Root scripts did not build packages before app checks | Workspace packages needed build artifacts before dependent app checks | Added package-first root scripts | Fixed |
| TypeScript issues in scaffold | Strict TS settings exposed missing declarations and alias mismatch | Fixed API import shape and web CSS declaration | Fixed |
| Generated artifacts polluted package test/build surface | Package builds emitted files that tests could pick up | Added source-only build/test config and ignored generated artifacts | Fixed |
| Env hygiene risk | Env files were copied from old build and could leak secrets if printed | Created key-only env inventory and kept local env files ignored | Fixed |

## Prevention Notes

- Keep root commands package-first.
- Keep env docs key-only.
- Keep generated artifacts outside source-only test globs.
- Run `npm run verify` after any baseline/script/package change.
