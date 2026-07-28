---
created: 2026-07-28
project: agentOps
ecosystem: [circle, full-stack]
tags: [operator-experience, routes, ux, console, control-plane]
---

# Operator Experience and Route Contract

[[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/docs/mainnet-planning/README|Mainnet planning index]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/PRODUCT|Current product]] | [[10-Projects/Web3-Builds/agentOps/BUILD-PMOA/DESIGN|Current design system]]

## Scope and preservation boundary

This document owns the information architecture and operator journeys introduced by the production domains. It does not redefine domain state, permissions, financial truth, or release status.

The existing authentication and onboarding design remains outside the console redesign scope unless a functional requirement forces a targeted change. The current left-card/right-form auth composition is preserved. Production onboarding may add security and setup steps, but does not replace auth with a drawer or console surface.

## Navigation hierarchy

Persistent sidebar routes represent durable product domains:

```text
Overview
Organization
  Members
  Roles and access
  Access reviews
Agents
  Registry
  Hierarchy and delegation
  Connections and credentials
Missions
Policies
Approvals
Providers
Treasury
  Positions
  Budgets and reservations
  Journal
  Reconciliation
Execution
  Runtime attempts
  Financial attempts
  Unknowns and recovery
Evidence
Incidents
Settings
```

Information-heavy domains use addressable subroutes, not a single table with a tab switcher. A contextual top or bottom in-page rail may switch closely related views within one entity, such as treasury positions/journal/reconciliation or one provider's offers/deliveries. It does not replace browser routes for independently operable workflows.

## Action placement

- Primary pages show status, exposure, exceptions, and next safe operator action.
- Creation and focused edits use right-side drawers when the user benefits from retaining page context.
- Destructive, financial, privilege, and emergency actions use review/confirmation surfaces that display immutable action context and required approvers.
- Duplicate actions are removed; one canonical action has one primary entry point plus contextual deep links.
- Bulk operations show selection scope, tenant, effect, rollback/recovery, and partial-failure behavior before execution.

## Exception-first operational UX

The console prioritizes awaiting approvals, unknown external outcomes, unreconciled differences, expiring credentials/certificates, evidence gaps, degraded execution profiles, incidents, and emergency stops.

Every exception detail page shows known facts, unknown facts, authority context, money exposure, last external lookup, evidence completeness, permitted actions, prohibited unsafe actions, owner, SLO, and escalation path.

## Treasury experience

Treasury is a routed operational area rather than one dense card:

- Positions and provider/wallet balances.
- Budget allocation and utilization including live holds.
- Reservations with attempt and authority links.
- Append-only journal and posting details.
- Reconciliation cases and external-source evidence.
- Liquidity/funding actions.
- Export and period controls.

Tables include search, filters, saved views, column controls, pagination or cursor loading, stable URLs, export, accessible empty/error states, and explicit freshness. Monetary values always show asset, unit, network, pending/available status, and source time.

## Agent and provider presentation

Agent and provider detail pages use the full content surface with restrained section boundaries rather than nested cards. Provider/chain identity can use original verified logos and transparent premium presentation, but visual identity never substitutes for verified provider, network, asset, or destination text.

## State and permission behavior

- URL and navigation state are deep-linkable and reload-safe.
- Permissions hide unavailable actions only when discovery itself is sensitive; otherwise disabled actions explain missing authority.
- Stale data is labeled and revalidated before destructive action.
- Optimistic UI never declares financial settlement, grant consumption, revocation, or reconciliation complete before authoritative confirmation.
- Errors preserve user input and provide one safe retry path tied to the original idempotency identity.
- Mobile views preserve exception handling and emergency stop; dense accounting workflows may require a supported minimum viewport.

## Route evidence and testing

Each route maps to an owning domain, permissions, commands, events, empty/loading/error/unknown states, audit events, analytics, and journey tests. Browser tests cover direct links, back/forward navigation, refresh during drawer/approval state, permission changes, stale data, partial failure, pagination, exports, and emergency revocation.

## Requirements

- `AOPS-UX-001` (`S1`): Every operational state MUST have one canonical addressable route and owning domain.
- `AOPS-UX-002` (`S0`): UI MUST NOT present submitted, unknown, unreconciled, or unverified financial work as complete.
- `AOPS-UX-003` (`S1`): Unknown, reconciliation, evidence, incident, and revocation states MUST expose safe operator actions and prohibited actions.
- `AOPS-UX-004` (`S1`): Information-heavy domain views MUST support filtering, pagination/cursors, stable URLs, and export where applicable.
- `AOPS-UX-005` (`S1`): Drawers MAY simplify focused creation/editing but MUST NOT hide multi-step financial or privilege review.
- `AOPS-UX-006` (`S1`): Auth visual composition MUST remain unchanged unless an approved functional ADR requires a scoped update.
- `AOPS-UX-007` (`S0`): UI actions MUST preserve backend idempotency, authority, certificate, and tenant boundaries.

## Exit criterion

The route map is production-ready only when every domain and cross-domain journey has an operable UI or documented API-only boundary, failure states are browser-tested, accessibility review passes, and current design tokens/components in `BUILD-PMOA/DESIGN.md` are reconciled with implementation.
