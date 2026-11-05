using AgentOps.Domain.Common;
using AgentOps.Domain.Enums;

namespace AgentOps.Domain.Entities;

public class AgentIdentity : BaseEntity, IAggregateRoot
{
    public string Name { get; private set; } = string.Empty;
    public string Role { get; private set; } = string.Empty;
    public string PublicKey { get; private set; } = string.Empty;
    public string OrganizationId { get; private set; } = string.Empty;
    public AgentStatus Status { get; private set; }
    public decimal DailyBudgetCapUsd { get; private set; }
    public decimal SpentTodayUsd { get; private set; }
    public DateTime BudgetResetDateUtc { get; private set; }
    public string ApiKeyHash { get; private set; } = string.Empty;

    private readonly List<ToolPermission> _toolPermissions = new();
    public IReadOnlyCollection<ToolPermission> ToolPermissions => _toolPermissions.AsReadOnly();

    private readonly List<ExecutionSession> _sessions = new();
    public IReadOnlyCollection<ExecutionSession> Sessions => _sessions.AsReadOnly();

    protected AgentIdentity() { }

    public AgentIdentity(string name, string role, string publicKey, string organizationId, decimal dailyBudgetCapUsd, string apiKeyHash)
    {
        Name = name ?? throw new ArgumentNullException(nameof(name));
        Role = role ?? throw new ArgumentNullException(nameof(role));
        PublicKey = publicKey ?? throw new ArgumentNullException(nameof(publicKey));
        OrganizationId = organizationId ?? throw new ArgumentNullException(nameof(organizationId));
        DailyBudgetCapUsd = dailyBudgetCapUsd >= 0 ? dailyBudgetCapUsd : throw new ArgumentException("Budget cannot be negative.");
        ApiKeyHash = apiKeyHash;
        Status = AgentStatus.Active;
        SpentTodayUsd = 0m;
        BudgetResetDateUtc = DateTime.UtcNow.Date;
    }

    public void AddToolPermission(string toolName, decimal maxSpendPerCallUsd, int rateLimitPerMinute, RiskLevel riskLevel)
    {
        var existing = _toolPermissions.FirstOrDefault(t => t.ToolName.Equals(toolName, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            existing.UpdateLimits(maxSpendPerCallUsd, rateLimitPerMinute, riskLevel);
        }
        else
        {
            _toolPermissions.Add(new ToolPermission(Id, toolName, maxSpendPerCallUsd, rateLimitPerMinute, riskLevel));
        }
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public bool CanSpend(decimal amountUsd)
    {
        ResetDailyBudgetIfExpired();
        return (SpentTodayUsd + amountUsd) <= DailyBudgetCapUsd && Status == AgentStatus.Active;
    }

    public void RecordSpend(decimal amountUsd)
    {
        ResetDailyBudgetIfExpired();
        SpentTodayUsd += amountUsd;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void Suspend(string reason)
    {
        Status = AgentStatus.Suspended;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void Activate()
    {
        Status = AgentStatus.Active;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    private void ResetDailyBudgetIfExpired()
    {
        if (DateTime.UtcNow.Date > BudgetResetDateUtc.Date)
        {
            SpentTodayUsd = 0m;
            BudgetResetDateUtc = DateTime.UtcNow.Date;
        }
    }
}
