using Microsoft.EntityFrameworkCore;
using AgentOps.Domain.Entities;
using AgentOps.Domain.Enums;
using AgentOps.Infrastructure.Persistence;

namespace AgentOps.Tests.Unit;

internal static class TestDb
{
    public const string Org = "acme";

    public static AgentOpsDbContext Create(string? name = null) => new(new DbContextOptionsBuilder<AgentOpsDbContext>()
        .UseInMemoryDatabase(name ?? Guid.NewGuid().ToString()).Options);

    public static AgentIdentity Agent(AgentOpsDbContext db, decimal dailyCap = 1000m, string tool = "pay_invoice",
        decimal perCall = 500m, RiskLevel toolRisk = RiskLevel.High)
    {
        var agent = new AgentIdentity("ops-agent", "Treasury", "0x" + Guid.NewGuid().ToString("N"), Org, dailyCap, "hash");
        agent.AddToolPermission(tool, perCall, 60, toolRisk);
        db.AgentIdentities.Add(agent);
        db.SaveChanges();
        return agent;
    }

    public static GovernancePolicy Policy(AgentOpsDbContext db, decimal autoApprove = 100m, RiskLevel maxRisk = RiskLevel.High, bool multiSig = false)
    {
        var policy = new GovernancePolicy("Treasury policy", "", Org, maxRisk, autoApprove, multiSig);
        db.GovernancePolicies.Add(policy);
        db.SaveChanges();
        return policy;
    }
}
