<p align="center">
  <img src="apps/web/public/landing/aops-wordmark.png" alt="AgentOps Wordmark" width="520" />
</p>

<p align="center">
  <strong>The organizational control plane for the agentic economy.</strong>
</p>

<p align="center">
  <img src="apps/web/public/landing/chains/arc.png" alt="Arc Network" height="26" />
  &nbsp;&nbsp;&nbsp;&nbsp;
</p>

---

<p align="center">
  <img src="apps/web/public/images/robot.png" alt="AgentOps Autonomous Agent" width="220" />
</p>

**AgentOps (AOPS)** gives autonomous agents programmable economic authority. It sits between an organization's agents and the financial infrastructure they use, providing the identity, policies, budgets, approvals, payment controls, and evidence required to let agents operate as accountable economic actors.

Agents can discover services, purchase resources, hire other agents, commission work, and move programmable money — while the organization remains in control of **who can act, what they can do, how much capital they can access, which counterparties they can transact with, and when a human must intervene**.

> **Wallets provide financial capability. AgentOps provides organizational authority.**

<p align="center">
  <img src="https://img.shields.io/badge/Language-C%23%2012-blue?logo=csharp" alt="C#" />
  <img src="https://img.shields.io/badge/Platform-.NET%208.0-purple?logo=dotnet" alt=".NET 8" />
  <img src="https://img.shields.io/badge/Framework-ASP.NET%20Core%20%7C%20MVC-512BD4?logo=dotnet" alt="ASP.NET Core MVC" />
  <img src="https://img.shields.io/badge/Database-SQL%20Server%20%26%20EF%20Core-CC292B?logo=microsoftsqlserver" alt="SQL Server" />
  <img src="https://img.shields.io/badge/Cloud-Microsoft%20Azure%20Queue%20%26%20Blob-0078D4?logo=microsoftazure" alt="Azure" />
  <img src="https://img.shields.io/badge/Background%20Workers-.NET%20BackgroundService-blueviolet" alt="BackgroundService" />
  <img src="https://img.shields.io/badge/Testing-xUnit%20%7C%20Moq-2496ED" alt="xUnit" />
</p>

---

## .NET Core & ASP.NET MVC Parallel Architecture

Alongside the TypeScript and EVM prototype, this repository incorporates a parallel, production-grade enterprise backend located in [`dotnet/`](file:///Users/18abhinav07/Documents/Brain/10-Projects/Web3-Builds/agentOps/AOPS-DotnetMigration/dotnet) implemented with **C# 12, .NET 8, ASP.NET Core Web API, ASP.NET MVC (Razor), Entity Framework Core, SQL Server, and Microsoft Azure Cloud Services**.

### Solution Structure

```
dotnet/
├── AgentOps.sln
│
├── AgentOps.API/                          # ASP.NET Core Web API & Operations MVC Console
│   ├── Controllers/                       # REST endpoints: Agent registration, policies, execution tracking
│   │   ├── AgentRegistrationController.cs
│   │   ├── GovernancePoliciesController.cs
│   │   ├── ExecutionTrackingController.cs
│   │   ├── ApprovalWorkflowsController.cs
│   │   ├── AuditTrailsController.cs
│   │   └── Mvc/                           # ASP.NET MVC Controllers (Razor Views & Forms)
│   │       ├── OperationsConsoleController.cs
│   │       └── PoliciesMvcController.cs
│   ├── Views/                             # Razor UI with Model Binding and CSRF Verification
│   │   ├── Shared/_Layout.cshtml
│   │   ├── OperationsConsole/Index.cshtml
│   │   └── PoliciesMvc/Create.cshtml, Index.cshtml
│   ├── wwwroot/js/governance-dashboard.js # DOM manipulation, telemetry feeds, dynamic approval triggers
│   ├── Middleware/                        # Custom Global Exception & Agent Auth middleware
│   ├── Program.cs                         # DI configuration, EF Core DbContext, Swagger OpenAPI
│   └── AgentOps.API.csproj
│
├── AgentOps.Application/                  # CQRS & Domain Service Abstractions
│   ├── Services/                          # PolicyEvaluationService, ExecutionLifecycleService, ApprovalService
│   ├── DTOs/                              # Strongly-typed Data Transfer Objects & ViewModels
│   ├── Validators/                        # FluentValidation request pipeline validation
│   └── AgentOps.Application.csproj
│
├── AgentOps.Domain/                       # Domain Entities & Value Objects (DDD)
│   ├── Entities/                          # AgentIdentity, GovernancePolicy, ToolPermission, ExecutionSession, AuditEvent
│   ├── Enums/                             # AgentStatus, PolicyActionType, ApprovalState, RiskLevel
│   ├── Exceptions/                        # PolicyViolationException, UnauthorizedToolException
│   └── AgentOps.Domain.csproj
│
├── AgentOps.Infrastructure/              # Data Persistence & Cloud Integration
│   ├── Persistence/
│   │   ├── AgentOpsDbContext.cs           # EF Core DbContext with Fluent API mappings & foreign keys
│   │   ├── Configurations/                # Table schemas, composite indexes, decimal precisions
│   │   ├── Migrations/                    # SQL Server code-first database migrations
│   │   └── SqlQueries/                    # Direct SQL Server queries with Dapper, CTEs & Window Functions
│   ├── Services/
│   │   ├── AzureQueueService.cs           # Azure Queue Storage SDK for asynchronous dispatch
│   │   └── AzureOpenAiAuditService.cs     # LLM semantic reasoning service for prompt egress risk
│   └── AgentOps.Infrastructure.csproj
│
├── AgentOps.Worker/                       # Asynchronous Background Processing
│   ├── BackgroundServices/                # .NET BackgroundService / IHostedService implementations
│   │   └── ExecutionReconciliationWorker.cs # Continuous consumer reconciling queue tasks & anchoring proofs
│   ├── Program.cs                         # Generic Worker Host configuration
│   └── AgentOps.Worker.csproj
│
└── AgentOps.Tests/                        # Automated Verification Suite
    ├── Unit/                              # xUnit tests for policy evaluation & execution state machines
    └── AgentOps.Tests.csproj
```

### Core Engineering Capabilities

| Component | .NET Implementation | Technical Highlights |
|---|---|---|
| **Agent Registration** | ASP.NET Core API | Unique public key validation, cryptographic API key generation, and role-based metadata persistence. |
| **Agent Identity** | C# Domain Entities & Value Objects | Enforced spending caps, daily reset schedules, permission bindings, and lifecycle state management. |
| **Governance Policies** | Policy Evaluation Engine | Algorithmic policy parsing checking spend thresholds, risk levels, and multi-sig escalation rules. |
| **Tool Permissions** | Authorization Service | Fine-grained per-tool spend limits, execution rate-limiting, and invocation authorization guards. |
| **Execution Tracking** | State-Transition Management | Complete execution lifecycle: `Queued` &rarr; `EvaluatingPolicy` &rarr; `AwaitingApproval` &rarr; `Executing` &rarr; `Completed`. |
| **Approval Workflows** | State Machine Logic | Human-in-the-loop approval triggers with configurable expiry windows and cryptographic decision signers. |
| **Audit Trails** | Persistent Audit Events | Merkle proof hashes, tamper-evident action logs, and immutable timestamps. |
| **Background Processing** | `.NET BackgroundService` | Hosted background workers listening to Azure Storage Queues for detached, asynchronous execution handling. |
| **Data Persistence** | EF Core 8 + SQL Server | Relational mapping, composite indexes, decimal precisions, and raw SQL queries using CTEs and `DENSE_RANK()`. |
| **Web Presentation** | ASP.NET MVC + Razor + HTML5 / CSS / JS | Operations console with interactive DOM manipulation, live telemetry graphs, and AJAX form submissions. |
| **Automated Testing** | xUnit, Moq, FluentAssertions | Unit and integration tests validating policy boundaries, spend cap violations, and state transitions. |

### SQL Server & Raw Query Showcase

The analytics engine uses optimized raw SQL queries with Dapper for telemetry aggregations and agent spend rankings:

```sql
WITH AgentSpendCTE AS (
    SELECT 
        a.Id AS AgentId,
        a.Name AS AgentName,
        a.Role,
        COALESCE(SUM(es.TotalExecutedSpendUsd), 0) AS TotalHistoricalSpendUsd,
        COUNT(es.Id) AS TotalSessionsExecuted
    FROM AgentIdentities a
    LEFT JOIN ExecutionSessions es ON es.AgentId = a.Id
    WHERE a.OrganizationId = @OrgId AND a.IsDeleted = 0
    GROUP BY a.Id, a.Name, a.Role
)
SELECT 
    AgentId,
    AgentName,
    Role,
    TotalHistoricalSpendUsd,
    TotalSessionsExecuted,
    DENSE_RANK() OVER (ORDER BY TotalHistoricalSpendUsd DESC, TotalSessionsExecuted DESC) AS [SpendRank]
FROM AgentSpendCTE
ORDER BY [SpendRank] ASC;
```

---

## Resume & Portfolio Highlights

```text
AgentOps – AI Agent Governance Platform | C# · .NET 8 · ASP.NET Core · SQL Server · Azure · EF Core
• Implemented an enterprise .NET 8 backend architecture for autonomous agent registration, authorization, and execution governance.
• Developed a policy evaluation engine with dynamic risk tiering, tool permission controls, and multi-sig human approval escalations.
• Designed relational SQL Server schemas, EF Core configurations, and high-performance SQL analytics with CTEs and window functions.
• Built asynchronous background services with .NET BackgroundService and Azure Queue Storage for decoupled execution workflows.
• Created an ASP.NET MVC Razor operations dashboard featuring responsive HTML5/CSS layouts, DOM manipulation, and fetch API telemetry feeds.
• Authored comprehensive xUnit test suites validating policy rules, state transitions, and spend boundary enforcement.
```

---

## Build & Test Instructions

```bash
# Navigate to the .NET solution directory
cd dotnet

# Restore NuGet dependencies
dotnet restore

# Build solution
dotnet build

# Execute automated tests
dotnet test

# Run API & MVC dashboard
dotnet run --project AgentOps.API
```

---

## Why AgentOps

The agentic economy introduces a new class of software actor.

A traditional application executes inside boundaries defined by its developers. An autonomous agent can make decisions dynamically, invoke external services, delegate work, and initiate financial transactions on its own.

Giving that agent a wallet solves only one problem: **how it can move money**.

Organizations also need answers to:

| Control Domain | Organizational Question |
|---|---|
| **Identity** | Which agent is acting? |
| **Authority** | What has the organization delegated to it? |
| **Capital** | How much can it spend? |
| **Counterparties** | Who can it transact with? |
| **Governance** | Which actions require approval? |
| **Accountability** | What policy authorized the transaction? |
| **Evidence** | Can the organization reconstruct the decision after settlement? |

AgentOps provides that missing organizational layer.

---

## What AgentOps Does

AgentOps combines the controls required to operate an autonomous agent organization in one unified system.

### Agent Identity
Every agent operates as an explicit organizational identity with its own role, credentials, wallet, policy bindings, and economic boundaries.

### Programmable Policies
Organizations define what agents are allowed to do before they begin operating. Policies can govern actions, counterparties, destinations, payment access, spending limits, and approval requirements.

The system is designed around a **fail-closed** model: actions without an applicable authorization are not permitted.

### Budgets & Capital Controls
Organizations can assign capital to individual agents, establish per-request limits and period budgets, and constrain where that capital can move. The agent's wallet provides the final hard financial boundary.

### Human Approvals
Not every action should be fully autonomous. AgentOps can escalate operations that exceed configured thresholds or require organizational approval. The approval becomes part of the governed execution path rather than an independent UI confirmation.

### Agent-to-Agent Commerce
Agents can hire and pay other agents under organizational policy.

AgentOps supports bounded intra-fleet payments using Permit2 and demonstrates autonomous second-hop delegation, where an agent can hire another agent using its own identity and economic authority.

### External Payments
AgentOps connects agent activity to Circle's payment infrastructure and x402/Gateway for machine-to-service commerce.

The control plane governs the decision and authority; the underlying financial infrastructure provides the payment rails.

### Escrow & Trust
For new or lower-trust relationships, AgentOps supports ERC-8183 escrow before moving toward more efficient standing payment relationships.

Completed interactions can feed into ERC-8004 identity and reputation, creating a path from guarded first interaction to established economic relationships.

### Cross-Chain Execution
Agent economic activity can span Arc and Base.

Cross-chain actions can remain subject to the same organizational policies and approval boundaries, including approval-gated execution before settlement on another network.

### Evidence Lifecycle
AgentOps connects the lifecycle of a governed action:

$$\text{Intent} \longrightarrow \text{Identity} \longrightarrow \text{Policy} \longrightarrow \text{Budget} \longrightarrow \text{Approval} \longrightarrow \text{Execution} \longrightarrow \text{Settlement} \longrightarrow \text{Evidence}$$

The resulting record provides the organizational context behind a financial transaction, rather than treating the blockchain transaction as an isolated event.

---

## The AgentOps Model

```mermaid
graph TD
    subgraph Org["Organization & Governance"]
        HO["Human Operators"]
        AA["Autonomous Agents"]
    end

    subgraph ControlPlane["AgentOps Control Plane"]
        ID["Agent Identity"]
        POL["Programmable Policy"]
        CAP["Capital & Budgets"]
        APP["Approval Engine"]
    end

    subgraph Execution["Financial Execution Rails"]
        CIR["Circle Infrastructure"]
        NET["Arc / Base Settlement"]
    end

    subgraph SettlementLayer["Settlement & Evidence"]
        SET["On-Chain Settlement"]
        EVI["Auditable Evidence Record"]
    end

    HO --> ID
    HO --> POL
    AA --> ID
    AA --> POL

    ID --> APP
    POL --> APP
    CAP --> APP

    APP --> CIR
    APP --> NET

    CIR --> SET
    NET --> SET
    SET --> EVI
```

AgentOps is intentionally an organizational layer rather than another wallet or payment SDK. Circle provides the financial infrastructure; AgentOps governs the authority under which autonomous software can use it.

---

## Demonstrated Agent Organization

The project was validated through a five-agent research organization operating across **Arc Testnet** and **Base Sepolia**:

```mermaid
graph TD
    subgraph Arc["Arc Testnet Domain"]
        ORCH["Orchestrator Agent"]
        DF["DataFetcher Agent"]
        AN["Analyst Agent"]
        WR["Writer Agent"]
    end

    subgraph Base["Base Sepolia Domain"]
        SR["SeniorReviewer Agent"]
    end

    ORCH -->|Commission & Pay| DF
    ORCH -->|Commission Analysis| AN
    AN -->|Second-Hop Delegation| WR
    ORCH -->|Cross-Chain Call| SR
```

### Agent Roles

| Agent | Role & Responsibility |
|---|---|
| **Orchestrator** | Coordinates the organization and commissions work |
| **DataFetcher** | Provides data acquisition capabilities |
| **Analyst** | Performs analysis and can exercise bounded second-hop delegation |
| **Writer** | Synthesizes completed work |
| **SeniorReviewer** | Provides review capability on Base |

Each agent has an independent identity and wallet.

### Demonstrated Capabilities

- Governed agent-to-agent payments
- Per-agent spending authority
- Policy-controlled hiring
- Second-hop delegation
- Permit2 settlement
- ERC-8183 escrow
- ERC-8004 identity and reputation
- Approval-gated cross-chain execution
- Capital revocation and recovery
- MCP-based agent interaction
- End-to-end evidence linking agent intent to blockchain settlement

---

## Economic Rails

AgentOps uses different settlement mechanisms according to the relationship being governed.

| Relationship | Rail | Purpose |
|---|---|---|
| **External Commerce** | **x402 / Circle Gateway** | Machine-to-service payments |
| **Established Agent Relationships** | **Permit2** | Bounded delegated agent-to-agent spending |
| **New / Lower-Trust Relationships** | **ERC-8183** | Guarded escrow for first interactions |
| **Reputation** | **ERC-8004** | Identity and reputation after completed interactions |

This creates a progression from guarded first interactions toward more efficient delegated spending as trust and organizational relationships develop.

---

## Governed Execution

A typical economic action follows the same control path regardless of the specific payment rail:

```mermaid
graph TD
    A["Autonomous Agent"] --> B["Agent Intent"]
    B --> C["Verify Identity"]
    C --> D["Evaluate Policy"]
    D --> E{"Policy Pass?"}
    
    E -->|No| F["Deny & Log"]
    E -->|Yes| G{"Budget Check"}
    
    G -->|Exceeded| H["Human Approval Gate"]
    H -->|Approved| I["Authorized Execution"]
    H -->|Rejected| F
    
    G -->|Within Limits| I
    
    I --> J["On-Chain Settlement"]
    J --> K["Evidence Record"]
```

This makes governance part of execution itself.

---

## Built on Circle and Arc

AgentOps is designed around the emerging stablecoin-native agent economy.

- **Circle** provides the underlying programmable financial infrastructure, including Developer-Controlled Wallets, Gateway, and x402.
- **Arc** provides the settlement environment in which the demonstrated agent economy operates.

AgentOps adds the organizational control layer around these primitives: identity, authority, policy, budgets, approvals, delegation, and evidence.

> **Circle provides financial rails. AgentOps governs how autonomous organizations use them.**

---

## MCP for Autonomous Agents

AgentOps exposes its capabilities through a hosted MCP interface so agents can interact with the same governed control plane used by human operators.

An agent can authenticate, discover available capabilities, request economic actions, and operate under the policies and authority assigned to its identity.

This makes AgentOps usable as infrastructure for autonomous agents rather than requiring every agent application to implement its own payment governance layer.

---

## Capital Lifecycle

Economic authority is treated as a lifecycle rather than a permanent wallet assignment.

```mermaid
graph LR
    A["1. Allocate"] --> B["2. Empower"]
    B --> C["3. Operate"]
    C --> D["4. Transact"]
    D --> E["5. Monitor"]
    E --> F["6. Revoke"]
    F --> G["7. Recover"]
```

An organization can allocate working capital to an agent, establish its operating boundaries, monitor its activity, revoke its authority, and recover remaining funds when that agent should no longer control capital.

---

# PMOA Submission History

AgentOps was developed through three PMOA submission checkpoints. Each checkpoint represents a meaningful stage of the product.

### Checkpoint 1 — Project, Team & Idea
**Deadline:** Sunday, 19 July 2026

The first checkpoint established the project direction.

We submitted the initial **AOPS / AgentOps concept**: an organizational control plane for autonomous agents operating in an emerging programmable-money economy.

The focus was the core product thesis:
- Agents should have explicit organizational identities.
- Economic authority should be policy-controlled rather than equivalent to wallet ownership.
- Organizations should be able to define budgets, permissions, and approval requirements.
- Agent activity should be auditable from intent through settlement.
- Circle's financial infrastructure and Arc could provide the underlying payment and settlement layer.

This checkpoint established the product idea that became the foundation for the implementation.

---

### Checkpoint 2 — Mid-Submission
**Deadline:** Sunday, 2 August 2026

Checkpoint 2 represented the first substantial working implementation.

By this stage, AgentOps had progressed from the initial concept into a functional **MCP HTTP and Circle payment-infrastructure implementation**. The Circle Gateway ecosystem and agent-facing payment path were substantially built, and the hosted MCP experience had become the primary interface for autonomous agents.

The remaining work was the expansion from that foundation into the full Arc-native agent economy demonstrated in the final submission. Major capabilities developed during this phase included:
- Arc integration and settlement
- Full multi-agent fleet execution
- Agent-to-agent commerce
- Agent hiring and delegation
- Second-hop agent interactions
- Invite / wire-token based agent onboarding
- Native AI-assisted fleet creation and organization setup
- The broader Permit2 and escrow economic model
- Cross-chain execution with approval governance
- Complete evidence and capital lifecycle flows

Checkpoint 2 therefore marked the transition from **a governed MCP and payment-control foundation** into the broader autonomous economic organization delivered at final submission.

---

### Checkpoint 3 — Final Submission
**Deadline:** Sunday, 9 August 2026

The final checkpoint completed the product and brought the remaining pieces together into a functional AgentOps MVP deployed across **Arc Testnet and Base Sepolia**.

The final implementation demonstrated:
- A five-agent autonomous research organization
- Independent agent identities and wallets
- Organizational policy enforcement
- Per-agent budgets and capital limits
- Agent-to-agent payments through Permit2
- Second-hop autonomous delegation
- ERC-8183 escrow for lower-trust relationships
- ERC-8004 identity and reputation
- Approval-gated cross-chain execution
- Circle-backed financial execution
- Hosted MCP for autonomous agents
- Human operator controls
- Capital revocation and recovery
- Evidence connecting agent intent, policy, approval, execution, and on-chain settlement

The final submission evolved the original idea from an organizational control-plane concept into a demonstrated economic operating layer for autonomous agents.

---

## Repository Structure

```text
AOPS-PMOA/
├── apps/
│   ├── web/                 # AgentOps operator experience
│   ├── api/                 # Control plane and governance API
│   └── mcp/                 # Hosted MCP interface
│
├── packages/
│   ├── contracts/           # Shared contracts and interfaces
│   ├── config/              # Shared configuration
│   ├── db/                  # Database layer
│   ├── runtime-client/      # Runtime API client
│   └── onchain/             # On-chain integrations
│
├── templates/               # Agent integration templates
├── demo/                    # Demonstration assets
├── docs/                    # Product and technical reference
│
├── PRODUCT.md
├── CONTRIBUTING.md
├── SECURITY.md
└── LICENSE
```

The repository contains the implementation and supporting product and technical reference material. The primary README is intentionally focused on the product, its capabilities, demonstrated architecture, and submission history rather than internal development journals or temporary engineering notes.

---

## Project Status

**Functional testnet MVP**

AgentOps has been demonstrated on **Arc Testnet** and **Base Sepolia** with live agent wallets, governed agent-to-agent transactions, escrow, approval-gated cross-chain execution, MCP interaction, and on-chain settlement evidence.

The current implementation is a testnet product and should not be interpreted as a production mainnet payment service.

---

## License

AgentOps is not be copied, redesigned or republished outside the official work in any way or form.
