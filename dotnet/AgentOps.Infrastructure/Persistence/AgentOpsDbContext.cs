using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Domain.Entities;
using System.Reflection;

namespace AgentOps.Infrastructure.Persistence;

public class AgentOpsDbContext : DbContext, IAgentOpsDbContext
{
    public AgentOpsDbContext(DbContextOptions<AgentOpsDbContext> options) : base(options)
    {
    }

    public DbSet<AgentIdentity> AgentIdentities => Set<AgentIdentity>();
    public DbSet<ToolPermission> ToolPermissions => Set<ToolPermission>();
    public DbSet<GovernancePolicy> GovernancePolicies => Set<GovernancePolicy>();
    public DbSet<PolicyRule> PolicyRules => Set<PolicyRule>();
    public DbSet<ExecutionSession> ExecutionSessions => Set<ExecutionSession>();
    public DbSet<ExecutionAction> ExecutionActions => Set<ExecutionAction>();
    public DbSet<ApprovalWorkflow> ApprovalWorkflows => Set<ApprovalWorkflow>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly());
    }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries<AgentOps.Domain.Common.BaseEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedAtUtc = DateTime.UtcNow;
                    break;
                case EntityState.Modified:
                    entry.Entity.UpdatedAtUtc = DateTime.UtcNow;
                    break;
            }
        }
        return await base.SaveChangesAsync(cancellationToken);
    }
}
