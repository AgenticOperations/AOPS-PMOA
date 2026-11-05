using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using AgentOps.Domain.Entities;

namespace AgentOps.Infrastructure.Persistence.Configurations;

public class ExecutionSessionConfiguration : IEntityTypeConfiguration<ExecutionSession>
{
    public void Configure(EntityTypeBuilder<ExecutionSession> builder)
    {
        builder.ToTable("ExecutionSessions");
        builder.HasKey(s => s.Id);

        builder.Property(s => s.SessionCorrelationId).IsRequired().HasMaxLength(128);
        builder.Property(s => s.TotalExecutedSpendUsd).HasPrecision(18, 4);

        builder.HasMany(s => s.Actions)
            .WithOne(a => a.Session)
            .HasForeignKey(a => a.SessionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(s => s.SessionCorrelationId);
        builder.HasIndex(s => new { s.AgentId, s.Status });
    }
}
