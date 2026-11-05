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

        // Entities create their own Guid ids in the domain. Telling EF the key is never
        // store-generated makes children added through a navigation (a tool permission on an
        // agent, an action on a session) get inserted rather than treated as updates.
        foreach (var entityType in modelBuilder.Model.GetEntityTypes()
                     .Where(t => typeof(AgentOps.Domain.Common.BaseEntity).IsAssignableFrom(t.ClrType)))
        {
            modelBuilder.Entity(entityType.ClrType).Property(nameof(AgentOps.Domain.Common.BaseEntity.Id)).ValueGeneratedNever();
        }
    }

    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        foreach (var entry in ChangeTracker.Entries<AgentOps.Domain.Common.BaseEntity>())
        {
            switch (entry.State)
            {
                // Audit events carry the time of the decision, and that time is part of their hash.
                case EntityState.Added when entry.Entity is not AgentOps.Domain.Entities.AuditEvent:
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
