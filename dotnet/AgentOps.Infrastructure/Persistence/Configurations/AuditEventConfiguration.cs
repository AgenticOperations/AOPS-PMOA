using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using AgentOps.Domain.Entities;

namespace AgentOps.Infrastructure.Persistence.Configurations;

public class AuditEventConfiguration : IEntityTypeConfiguration<AuditEvent>
{
    public void Configure(EntityTypeBuilder<AuditEvent> builder)
    {
        builder.ToTable("AuditEvents");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.EventType).IsRequired().HasMaxLength(64);
        builder.Property(e => e.OrganizationId).IsRequired().HasMaxLength(64);
        builder.Property(e => e.ActionName).IsRequired().HasMaxLength(100);
        builder.Property(e => e.CapitalTransactedUsd).HasPrecision(18, 4);
        builder.Property(e => e.MerkleProofHash).IsRequired().HasMaxLength(128);

        builder.HasIndex(e => new { e.OrganizationId, e.CreatedAtUtc });
        builder.HasIndex(e => e.AgentId);
    }
}
