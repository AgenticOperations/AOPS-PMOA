using AgentOps.Domain.Common;
using AgentOps.Domain.Enums;

namespace AgentOps.Domain.Entities;

public class GovernancePolicy : BaseEntity, IAggregateRoot
{
    public string Name { get; private set; } = string.Empty;
    public string Description { get; private set; } = string.Empty;
    public string OrganizationId { get; private set; } = string.Empty;
    public RiskLevel MaxAllowedRiskLevel { get; private set; }
    public decimal AutoApprovalSpendThresholdUsd { get; private set; }
    public bool RequiresMultiSigForExternalTransfers { get; private set; }
    public bool IsActive { get; private set; } = true;

    private readonly List<PolicyRule> _rules = new();
    public IReadOnlyCollection<PolicyRule> Rules => _rules.AsReadOnly();

    protected GovernancePolicy() { }

    public GovernancePolicy(
        string name,
        string description,
        string organizationId,
        RiskLevel maxAllowedRisk,
        decimal autoApprovalThresholdUsd,
        bool requiresMultiSig)
    {
        Name = name;
        Description = description;
        OrganizationId = organizationId;
        MaxAllowedRiskLevel = maxAllowedRisk;
        AutoApprovalSpendThresholdUsd = autoApprovalThresholdUsd;
        RequiresMultiSigForExternalTransfers = requiresMultiSig;
        IsActive = true;
    }

    public void AddRule(string targetResourceType, string conditionExpression, PolicyActionType actionType)
    {
        _rules.Add(new PolicyRule(Id, targetResourceType, conditionExpression, actionType));
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public PolicyActionType EvaluateSpend(decimal requestedSpendUsd, RiskLevel actionRisk)
    {
        if (!IsActive) return PolicyActionType.Deny;
        if (actionRisk > MaxAllowedRiskLevel) return PolicyActionType.Deny;

        if (requestedSpendUsd > AutoApprovalSpendThresholdUsd)
        {
            return RequiresMultiSigForExternalTransfers ? PolicyActionType.RequireMultiSig : PolicyActionType.RequireHumanApproval;
        }

        return PolicyActionType.Allow;
    }
}
