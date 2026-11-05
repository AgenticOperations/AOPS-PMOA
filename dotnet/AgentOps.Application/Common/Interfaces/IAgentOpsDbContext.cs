using Microsoft.EntityFrameworkCore;
using AgentOps.Domain.Entities;

namespace AgentOps.Application.Common.Interfaces;

public interface IAgentOpsDbContext
{
    DbSet<AgentIdentity> AgentIdentities { get; }
    DbSet<ToolPermission> ToolPermissions { get; }
    DbSet<GovernancePolicy> GovernancePolicies { get; }
    DbSet<PolicyRule> PolicyRules { get; }
    DbSet<ExecutionSession> ExecutionSessions { get; }
    DbSet<ExecutionAction> ExecutionActions { get; }
    DbSet<ApprovalWorkflow> ApprovalWorkflows { get; }
    DbSet<AuditEvent> AuditEvents { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
