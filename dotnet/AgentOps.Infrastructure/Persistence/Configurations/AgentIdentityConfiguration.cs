using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using AgentOps.Domain.Entities;

namespace AgentOps.Infrastructure.Persistence.Configurations;

public class AgentIdentityConfiguration : IEntityTypeConfiguration<AgentIdentity>
{
    public void Configure(EntityTypeBuilder<AgentIdentity> builder)
    {
        builder.ToTable("AgentIdentities");
        builder.HasKey(a => a.Id);

        builder.Property(a => a.Name).IsRequired().HasMaxLength(100);
        builder.Property(a => a.Role).IsRequired().HasMaxLength(100);
        builder.Property(a => a.PublicKey).IsRequired().HasMaxLength(128);
        builder.HasIndex(a => a.PublicKey).IsUnique();

        builder.Property(a => a.OrganizationId).IsRequired().HasMaxLength(64);
        builder.Property(a => a.DailyBudgetCapUsd).HasPrecision(18, 4);
        builder.Property(a => a.SpentTodayUsd).HasPrecision(18, 4);

        builder.HasMany(a => a.ToolPermissions)
            .WithOne(p => p.Agent)
            .HasForeignKey(p => p.AgentId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(a => a.Sessions)
            .WithOne(s => s.Agent)
            .HasForeignKey(s => s.AgentId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(a => new { a.OrganizationId, a.Status });
    }
}
