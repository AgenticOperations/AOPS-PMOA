using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using AgentOps.Domain.Entities;

namespace AgentOps.Infrastructure.Persistence.Configurations;

public class GovernancePolicyConfiguration : IEntityTypeConfiguration<GovernancePolicy>
{
    public void Configure(EntityTypeBuilder<GovernancePolicy> builder)
    {
        builder.ToTable("GovernancePolicies");
        builder.HasKey(p => p.Id);

        builder.Property(p => p.Name).IsRequired().HasMaxLength(120);
        builder.Property(p => p.OrganizationId).IsRequired().HasMaxLength(64);
        builder.Property(p => p.AutoApprovalSpendThresholdUsd).HasPrecision(18, 4);

        builder.HasMany(p => p.Rules)
            .WithOne(r => r.Policy)
            .HasForeignKey(r => r.PolicyId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(p => new { p.OrganizationId, p.IsActive });
    }
}
