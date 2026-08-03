---
created: 2026-08-01
project: agentOps
ecosystem: circle
tags: [architecture, userflow, explainer, as-built]
status: non-normative explainer, grounded in current source
---

# agentOps PMOA — What Actually Happens Right Now, In Plain Language

This document explains the system as it is actually built today, traced directly from the source code (not from design docs or aspirations). It walks through who talks to whom, what gets stored where, what Redis is actually used for, what Postgres actually holds, and where the honest gaps are. It also cross-references `checker.md` — a separate, non-normative review that audits assumptions in the *design* — and says clearly which of its claims are confirmed by the real code, and which are about a future/aspirational version of the product.

Nothing here is a criticism of intent. It is a description of the current state, so that decisions get made against reality rather than against the diagram in someone's head.

---

## 1. The four services, and who they really are

There are four running processes. Each one has a narrow job, and — importantly — three of the four never touch the database or Redis directly except one, which is the center of gravity for almost everything interesting.

- **The web app** (Next.js, port 3005) is the thing a human operator opens in a browser. It does not hold any real state itself. It is a thin front door: it manages the login cookie, and every piece of data it shows or changes, it fetches from the API over plain HTTP. Think of it as a very smart form-renderer with no memory of its own.

- **The API** (Fastify, the actual default port in code is 4010, though the README describes it as 8080 — a small but real discrepancy worth knowing about) is where everything actually lives. Identity, policy, approvals, operations, payments, evidence — all of it is here. This is the one service that talks to Postgres and Redis.

- **The Circle worker** is a second, private process that exists purely because talking to Circle's systems (wallets, gateway, provider APIs) requires holding sensitive session material that the public-facing API should never be trusted with. It's reachable only over an internal HTTP path, guarded by a shared secret token, and it is explicitly restricted to testnet — it will refuse to run anything that isn't marked as test mode.

- **The MCP service** (the "remote control" surface for AI agents, port 8070 hosted, or run locally as a stdio process) is the thinnest layer of all. It holds no state of its own — no database connection, no Redis connection, nothing. Every tool an agent calls through MCP is just a bearer-authenticated HTTP call forwarded to the API's runtime routes. MCP is a translator, not a participant.

The mental picture: **the API is the brain and the only source of truth. Everything else is a mouth, an ear, or a pair of hands.**

---

## 2. How a human actually gets in (the login story)

When someone opens the web app and signs in with Google, here's the real sequence, not the theoretical one:

1. The web app generates a random `state` value, drops it into a short-lived cookie, and then — this is the detail people usually assume differently — it doesn't build the Google login URL itself. It asks the API to build that URL for it. The web app is deliberately kept dumb about anything involving actual OAuth logic.

2. The person logs into Google. Google redirects back to the web app's callback page. The web app checks that the `state` cookie matches, then hands the authorization code to the API.

3. The API is the one that actually talks to Google's servers, exchanges the code for real tokens, and figures out who the person is. It then creates a session — and this is worth being precise about: **the session is not a JWT.** It's a random opaque token, and the API stores only a hashed version of it in Postgres (a table called `auth_sessions`), with a 7-day expiry. Every time that token is used, the API touches `last_used_at` on the row, so there's a live trail of when a session was last active.

4. The web app takes that opaque token and sets it as the browser's own session cookie. From that point on, every request the web app makes to the API on the user's behalf just forwards that cookie's value as a bearer token.

There is no Redis involved anywhere in this. Sessions are pure Postgres. If Redis went away entirely, login would be completely unaffected — that matters, and it's a deliberate (if perhaps accidental) resilience property.

---

## 3. What Redis is actually for — and it is almost nothing

This is one of the more important findings, because "Redis" tends to imply a lot of infrastructure — sessions, job queues, rate limiting, pub/sub. None of that is true here. There is exactly one thing Redis does in this entire system:

**It caches treasury balance lookups for 25 seconds.**

That's it. One cache key per organization, one short TTL, and — notably — every single read or write to Redis is wrapped so that if Redis is down or unreachable, the code silently falls back to "no cache" and keeps working. Redis failing does not break payments, does not break sessions, does not break rate limiting. It only means balance lookups get slightly slower and hit Postgres directly instead of a cache.

So: **no BullMQ, no job queue, no pub/sub, no distributed locks living in Redis.** If you came in assuming Redis was doing queueing or session storage, that assumption should be dropped. It is a single, low-stakes, fail-open cache.

---

## 4. Where the "job queue" actually lives — it's Postgres, disguised as a worker

The README talks about the Circle worker as a "liquidity job processor," which sounds like it's consuming from a message queue. It isn't. What's actually happening is simpler and more old-fashioned:

- There's a plain Postgres table (`circle_provider_jobs`) that holds rows representing pending Circle operations — things like topping up a wallet or preparing liquidity.
- The Circle worker runs a loop on a timer (every 5 seconds by default) that polls that table directly with a SQL query, looking for jobs that are queued, or stuck, or recently failed in a retryable way.
- To make sure two workers (or the same worker running twice) don't grab the same organization's job at the same time, it uses a **Postgres advisory lock** — a built-in Postgres mechanism for "only one process gets to touch this key at a time" — keyed per organization. It is not a queue library's built-in exclusivity; it's a raw database-level mutex.

So the "job processor" is really: a table, a polling loop, and a database lock. It works, but it's worth knowing it's not the kind of durable, retry-aware queue infrastructure the name might suggest.

One neat consequence of this design: both the API and the Circle worker run their own database migrations on startup, and because they can start at nearly the same moment, they use that same advisory-lock trick so that whichever one starts first "wins" the migration run and the other one just waits and observes what got applied. It's a small, elegant reuse of the same primitive.

---

## 5. What's actually in Postgres — the real tables, grouped by what they mean

Postgres is genuinely the single source of truth for this whole system. There's no ORM — every table is read and written with hand-written, parameterized SQL. That's a deliberate style choice (traceable, explicit, no abstraction magic), though it does mean discipline is doing the work an ORM's guardrails would otherwise do.

Grouped by what they represent, not by migration file:

- **Who exists**: organizations, users, memberships, teams, agents, connections, and the credentials tied to those connections. This is the identity spine — who is a human, who is an agent, and how they're linked to an organization.

- **How people log in**: OAuth account links and the session table described above.

- **What's allowed**: policy actions, policy drafts, versioned policies, which policies are bound to which targets, and a running log of every policy decision made. Policy here is genuinely versioned and immutable once active — a real, non-trivial piece of engineering.

- **Who approved what**: approval requests, the actions taken on them, and a record of each approval being "consumed" (used up) so the same approval can't quietly authorize two different things.

- **Operational controls**: a catalog of tools/operations agents can invoke, rate limits and rate-limit counters, and a log of operational decisions.

- **Money**: this is the biggest and busiest group. Treasury records per organization, payment sources, per-agent payment accounts (with budget, spent, and reserved columns), a log of payment "route observations" (i.e., attempts and their outcomes), payment reservations, and payment events. On the Circle side specifically: payment modes, chain capabilities, wallet sets, per-chain wallets, and the provider-jobs table already mentioned.

- **The tamper-evident trail**: audit events and a per-organization "head" pointer, which is the actual hash-chain implementation (much more on this below).

**What is explicitly not there**: there is no ledger table, no journal-entries table, no double-entry bookkeeping structure anywhere in the schema. This directly confirms what `checker.md` claims — money movement is recorded as simple counter increments and decrements on a handful of numeric columns (like "spent so far" and "reserved so far"), not as a proper accounting ledger where every movement is a balanced pair of entries that can never be edited, only appended to and corrected by a new entry. It works for now, but it means "how much has this agent actually spent, provably, over time" is answered by trusting a mutable running total, not by summing an immutable history.

---

## 6. Which Circle wallet model is actually used — a direct answer

This is worth its own section because `checker.md` treats it as an open, unresolved strategic question (its sections A3 and B1): should agentOps be built on Circle **Agent Wallets** (human-owned, OTP-gated, 2-of-2 MPC) or **Developer-Controlled Wallets** (backend holds an "entity secret" and can act programmatically, no human OTP step)? `checker.md` argues this choice determines whether agentOps can genuinely be "the enforcement point," because Agent Wallets require a human with an inbox to approve anything that changes spending limits, while Developer-Controlled Wallets would let agentOps' own backend act without a human in the loop.

Tracing the actual code gives a clean, unambiguous answer:

**Agent Wallets is what's really wired up and shipped as the default. Developer-Controlled Wallets exists in the code, but it is dead in production.**

Concretely:

- When an organization "connects" its Circle account inside agentOps, the flow is a genuine Circle Agent Wallets login: an email address, followed by a human typing in a 6-digit OTP they received. Under the hood, this is done by literally shelling out to Circle's own real command-line tool (`@circle-fin/cli`) with the actual command `wallet login --type agent --init`, then completing it with `wallet login --request <id> --otp <code>`. This is not a simulation of Agent Wallets or a similarly-named internal concept — it's the real product, driven the way Circle's own documentation describes using it.

- Every real (non-simulated) payment — sending USDC, checking a balance, doing a Gateway deposit, paying an x402 service — happens by shelling out to that same CLI (`wallet transfer`, `services pay`, `gateway deposit`, and so on). Circle's own infrastructure holds the actual signing key and does the actual signing. agentOps' backend never touches a raw private key, and it never handles anything called an "entity secret" in the real, running path.

- There *is* a second, fully-built implementation sitting in the code for Developer-Controlled Wallets — real integration with Circle's actual developer-controlled-wallets SDK, entity secret and all. But it only activates if someone explicitly sets an environment variable (`CIRCLE_TREASURY_PROVIDER=developer_controlled`), and even then, the real server process that actually executes payments (the Circle worker) never reads that environment variable at all — it's hardcoded to use the Agent Wallets path regardless. So this alternate implementation is present in the codebase but inert; nothing in the deployed system can currently reach it.

- There's also a third, much simpler mode: **simulation**. A payment source can be marked as simulated, in which case nothing touches Circle or any blockchain at all — the system just decrements a plain number in a Postgres column and returns a synthetic success. The system is honest about this internally, tagging these as "not broadcast" rather than "settled," so it's not pretending to be real.

**What this settles about your specific question — does agentOps behave as "the agent" with its own policy-governed wallet, paying through the Circle stack itself:** no, it does not. agentOps never holds a Circle wallet of its own and never pays anything out on its own behalf. Every wallet belongs to a specific organization, connected by that organization's own human via the OTP flow described above. agentOps' actual job, every time, is: evaluate its own internal policy rules and approval thresholds against a request to spend that organization's money, and — only if that clears — tell the organization's already-connected Circle Agent Wallet to go ahead and sign and settle the payment. **agentOps is the gate in front of someone else's wallet. It is never itself the paying party.**

This also makes `checker.md`'s open question a settled, present-tense fact rather than a hypothetical: because Agent Wallets is genuinely what's running, the limitation that document warns about is real today — agentOps cannot programmatically read or change Circle-side spending limits through any API, because no code anywhere calls a Circle limits/policy endpoint. If a spending limit needs to change on the Circle side, that requires a human with access to the connected email account, not agentOps acting alone. The "stronger, backend-programmatic" alternative `checker.md` recommends investigating is sitting fully-written in the codebase — it's just switched off.

The two actual payment rails that move real money both go through this same Agent Wallet custody, just using different underlying x402 mechanics: one is Circle's "Gateway" rail (a signed batch-style authorization), the other is the "exact" rail (a more direct per-payment signed authorization). Both are genuinely real — they move real testnet USDC and are verified on-chain — and in both cases, the actual cryptographic signature is produced by Circle's infrastructure via the CLI, not by a key agentOps holds itself.

---

## 7. How the API and the Circle worker actually talk to each other

This is a clean, well-thought-out boundary, worth describing precisely because it's one of the better-built seams in the system.

The Circle worker is a separate process specifically so that anything requiring sensitive Circle session material — API keys, temporary credentials, the actual CLI that talks to Circle — stays out of the public-facing API process entirely. If the public API were ever compromised, the attacker still wouldn't have a path to Circle's systems directly.

The two talk over plain internal HTTP, protected by a shared bearer token that must be at least 32 characters long, checked with a timing-safe comparison (so an attacker can't guess the token faster by measuring how long a wrong guess takes to get rejected — a real, deliberate security detail). Every route the worker exposes — connecting a Circle account, initiating a wallet action, checking balances — requires that token, except for a plain health check.

There's a hard, server-enforced guardrail here too: the worker refuses to process anything that isn't explicitly marked as a test-mode operation. This isn't just a convention the API is supposed to respect — the worker itself checks and throws an error if you try to use it for anything that looks like a live/mainnet operation. That's a genuinely good "belt and suspenders" design choice, because it means even if something upstream forgets to gate a request properly, the worker itself is the second, independent line of defense.

One interesting asymmetry: if the shared token is wrong (misconfigured) versus if the worker is simply down/unreachable, the API deliberately can't tell the difference from outside — both look like the same "service unavailable" error to whoever called it. That's a reasonable security tradeoff (don't leak "your token is wrong" to an attacker) but it does mean debugging a misconfigured token requires checking logs, not just watching the error the caller sees.

For its own job-processing loop, the worker doesn't call back into the API at all — it reaches into the same Postgres database directly, using the same functions the API's payments code uses. So the two processes share a database as their real coordination point, not an API contract between themselves for that particular flow.

Getting Circle's actual signing/broadcasting to happen involves the worker shelling out to Circle's own command-line tool as a subprocess, with retry logic for the kind of transient errors (rate limits, server hiccups) you'd expect from any external API.

---

## 8. How an AI agent actually talks to the system (the MCP path)

This is the part built specifically for autonomous agents, as opposed to human operators. An agent — whether it's a hosted service calling in over the network, or a locally-running process — connects to MCP with a bearer credential. That credential is not some separate agent-specific secret system; it is literally the same connection-credential record created when a human operator, inside the console, creates a credential for that agent. One identity system, two doors into it.

Every tool exposed to an agent through MCP — checking whether an action is allowed, onboarding, making an x402 payment, checking or consuming an approval, recording an activity, checking or recording an operation — is, underneath, just a validated HTTP call to one of the API's runtime routes. MCP does no independent thinking; it's a faithful translator between "agent calls a named tool with some arguments" and "HTTP POST to a specific runtime endpoint with a JSON body."

Walking one real example all the way through — an agent trying to pay for something via x402:

1. The agent calls the `payment_x402` tool through MCP with details about what it's trying to pay for.
2. MCP validates the shape of that request and forwards it as an HTTP call to the API, with the agent's bearer credential attached.
3. The API resolves that bearer credential back to a specific organization, agent, and connection — this is a real database lookup joining the credentials table through connections to agents, not a cached or assumed identity.
4. From there, the request enters the real payment flow described in detail in the next section.
5. Whatever the outcome — success, a policy-required-approval pause, a budget rejection — flows back through the same chain and gets reshaped by MCP into a response the agent's tool-calling interface understands, including some specifically-worded messaging for "this needs a human's approval first" and "liquidity is still being prepared" cases.

The important structural point: **MCP itself never touches a database, never touches Redis, never talks to the Circle worker.** Every consequential thing happens inside the API. MCP's entire value is translation and authentication forwarding.

---

## 9. The actual payment journey, step by step, honestly

This is the part worth being most precise about, because it's where "does this actually work as described" matters most.

When an agent (through MCP, or in principle any other authenticated caller) asks to make an x402 payment, here is the real order of operations, all wrapped in one database transaction so it either all happens or none of it does:

1. The system loads that agent's payment account — its budget, how much it's already spent, how much is currently reserved (held but not yet finalized), its per-request cap, and which payment rails it's allowed to use.

2. It checks the requested payment against what the organization's payment mode and the request's rail actually support. Every attempt — whether it's accepted or rejected at this stage — gets logged as a "route observation" row, so there's a record even of the failed attempts, not just the successful ones.

3. It checks the per-request cap: is this single payment larger than the agent is allowed to spend in one request?

4. It checks the overall budget: would this payment, added to what's already spent and what's already reserved, exceed what this agent is allowed to spend in total? **This check is plain arithmetic on two numeric columns** — spent-so-far and reserved-so-far — not a query against a ledger of individual transaction records. It's a real check, it's just a simpler mechanism than an accounting ledger would be.

5. Depending on whether this is a simulated payment or a real one, it checks that the underlying balance (simulated, or an actual Circle wallet) can actually cover it.

6. **Only now does it check policy** — and this ordering detail matters. The business-rule checks above (budget, cap, rail support) happen *before* the policy engine is consulted. This isn't the same as `checker.md`'s specific concern about external network calls escaping before any check happens at all (that's a different, more dangerous failure mode about outbound requests firing before any gate exists) — but it is true that policy is not literally the first thing evaluated in this particular flow.

7. The policy check itself is real and meaningfully implemented: it looks at the organization's active, versioned policy rules and evaluates them against this specific request. If policy says "deny," the request is rejected outright. If policy — or a configured spending threshold on the account — says "this needs human approval," the system either matches this request against an approval a human already granted (matched by a hash of the exact request details, so an approval for one thing can't quietly authorize something slightly different) or creates a brand-new approval request and pauses here, waiting for a human.

   Here's the part worth flagging plainly, because it's confirmed directly in the code: **if no policy rule actually matches a given request, the default outcome is "allow."** This is not a hypothetical risk — it's the literal seed value the decision logic starts from. An organization that hasn't yet written a rule for a particular kind of action will have that action silently allowed by default, not silently blocked. This matches exactly what `checker.md` warns about, and it's real, present-tense behavior in the running code today, not a historical or hypothetical concern.

8. Assuming everything above clears, the system checks that the actual payment rail/chain is capable of handling this (skipped in pure simulation mode).

9. It executes the settlement. Depending on the payment source, this is one of three things (see section 6): a plain simulation with a Postgres balance decrement and no chain interaction, or a real settlement where the org's connected Circle Agent Wallet actually signs and moves testnet USDC via the CLI, on either the Gateway rail or the exact rail. In test mode with the direct-payment rail, this also means actually fetching the paid-for resource from a real endpoint that verifies payment (this part is genuinely real — it checks actual on-chain transfer events on real testnets, not a mock).

10. Finally, it records the outcome: a payment "reservation" row marked as settled, an increment to the agent's spent-total counter, a decrement to the simulated balance if applicable, another route-observation entry, and a human-readable activity log entry that operators can see in the console.

The honest summary: **the policy engine, the approval workflow, and the on-chain verification for test payments are all real, working mechanisms — not stubs.** But the actual bookkeeping of money — how much has been spent, how much is reserved — is done with simple mutable counters, not an auditable, append-only ledger. If someone needed to prove, months later, exactly how a balance arrived at its current number, today's system can't reconstruct that from first principles the way a proper ledger could; it can only show you the current counter value and a separate, non-ledger activity log alongside it.

Also worth stating plainly, because it's directly checkable in the code: there is currently no broad "kill switch" — no single control that halts all activity for an agent or organization in an emergency. The closest things that exist are narrower, per-target rate-limit toggles, which is a meaningfully smaller safety net than an emergency stop.

And on approvals specifically: nothing in the code currently stops the same person who is generally allowed to approve things from approving a request connected to something they themselves triggered, as long as they hold the right role. There's no separate "you can't approve your own action" rule, and no requirement for more than one person to sign off, even on larger or riskier actions.

---

## 10. The evidence trail — genuinely solid, with one real, specific weak point

This is one of the better-built parts of the system, and it deserves credit for that before describing its limitation.

Every consequential action — a policy decision, an approval being created or acted on, and other domain events — gets written into an append-only `audit_events` table, inside the **same database transaction** as the actual change it's describing. That matters: it means you can't end up with a policy decision that happened but wasn't recorded, or a recorded event describing something that didn't actually happen — they succeed or fail together.

Each event is hash-chained to the one before it: the event's own hash is computed from its content plus the previous event's hash plus its position in the sequence. This means tampering with any single past event would break the hash of every event after it — assuming you check the whole chain.

There's also real idempotency protection: if the same logical event is submitted twice with an idempotency key, the system checks whether it's genuinely a duplicate or a conflicting change disguised as a duplicate, and rejects the latter rather than silently overwriting anything.

Here is the specific, real limitation, confirmed directly in the verification code: when you ask the system to verify the audit chain, it caps how many events it will check in a single call — up to 500, always starting from the very beginning of the organization's history. If an organization has built up more than 500 audit events, a single verification call only proves the *first* five hundred are intact; it does not automatically continue checking the rest, and nothing forces a caller to loop through the remaining pages to get full coverage. So in practice, for any organization with real history behind it, "the chain verified successfully" today often means "the earliest part of the chain verified successfully" — which is exactly the gap `checker.md` describes as "prefix-only verification." The chain-hashing logic itself is not a stub; it's the *scope of a single verification call* that's limited, and nothing in the current system automatically stitches together a full-history check, or checks from the most recent event backward to catch someone having deleted a chunk of history off the end.

---

## 11. Two small, concrete things worth knowing that don't fit anywhere else

- The README describes the API as running on port 8080. The actual default in the configuration code is a different port (4010). Whatever port is actually live in any given deployment depends on how the environment variable is set — but the documented default and the coded default disagree, which is worth reconciling so nobody loses time chasing a "why won't it connect on 8080" problem.

- There's a shared-types package intended to keep the web app and the API speaking the same language about what data looks like. In practice, it currently holds only a handful of very generic shapes (health-check responses and a couple of small schemas) — the real, detailed shapes for payments, policy, and identity data are defined separately, by hand, inside the web app and inside the API, rather than through that shared package. That means it's structurally possible for the two sides to drift out of sync on what a given payload looks like, without anything catching it automatically at build time.

---

## 12. How this connects back to `checker.md`

`checker.md` is a design-and-assumptions review — it asks big questions like "does a customer for this actually exist," "is agentOps really the enforcement point if it's built on certain Circle products," and "can a reservation ever really be released." Those are real, important questions, but they are largely questions about strategy and about a *future* build, not descriptions of what's running today.

Where this document and `checker.md` overlap on describing *current* code, they agree, and this trace independently confirms several of its most specific claims: policy really does default to allow when nothing matches; the treasury/ledger really is simple counters, not double-entry bookkeeping; approvals really can be granted by any qualifying operator with no dual-control requirement; and the evidence chain's verification really is bounded rather than guaranteed-complete over an organization's full history.

One important item moves from "open question" to "settled fact" in this update: `checker.md`'s section A3/B1 asks, as an unresolved strategic question, whether agentOps is built on Circle Agent Wallets or Developer-Controlled Wallets, and argues the answer determines whether agentOps can genuinely be an enforcement point. Section 6 above answers this directly from the code: it's Agent Wallets, shipped as the hardcoded default, with a fully-built Developer-Controlled Wallets alternative sitting unused behind an environment flag the production path never reads. That means the specific limitation `checker.md` warns about — that agentOps cannot programmatically read or write Circle-side spending limits, and needs a human with OTP access for anything on that surface — is real, present-tense behavior today, not a hypothetical to plan around.

Where `checker.md` talks about whether reservations could be made cryptographically self-releasing, or whether the whole product is built for a confirmed customer, those remain genuinely open strategic questions about direction, not gaps in what's been built so far. This document doesn't take a position on those; it only describes what exists right now, so that conversation can start from an accurate floor rather than a guess.
