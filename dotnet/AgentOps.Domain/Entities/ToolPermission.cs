using AgentOps.Domain.Common;
using AgentOps.Domain.Enums;

namespace AgentOps.Domain.Entities;

public class ToolPermission : BaseEntity
{
    public Guid AgentId { get; private set; }
    public string ToolName { get; private set; } = string.Empty;
    public decimal MaxSpendPerCallUsd { get; private set; }
    public int RateLimitPerMinute { get; private set; }
    public RiskLevel RiskLevel { get; private set; }
    public bool IsEnabled { get; private set; } = true;

    public AgentIdentity Agent { get; private set; } = null!;

    protected ToolPermission() { }

    public ToolPermission(Guid agentId, string toolName, decimal maxSpendPerCallUsd, int rateLimitPerMinute, RiskLevel riskLevel)
    {
        AgentId = agentId;
        ToolName = toolName;
        MaxSpendPerCallUsd = maxSpendPerCallUsd;
        RateLimitPerMinute = rateLimitPerMinute;
        RiskLevel = riskLevel;
        IsEnabled = true;
    }

    public void UpdateLimits(decimal maxSpend, int rateLimit, RiskLevel risk)
    {
        MaxSpendPerCallUsd = maxSpend;
        RateLimitPerMinute = rateLimit;
        RiskLevel = risk;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void Disable()
    {
        IsEnabled = false;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}
