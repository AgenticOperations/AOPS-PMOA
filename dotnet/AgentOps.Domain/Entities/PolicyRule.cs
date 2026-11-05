using AgentOps.Domain.Common;
using AgentOps.Domain.Enums;

namespace AgentOps.Domain.Entities;

public class PolicyRule : BaseEntity
{
    public Guid PolicyId { get; private set; }
    public string TargetResourceType { get; private set; } = string.Empty;
    public string ConditionExpression { get; private set; } = string.Empty;
    public PolicyActionType ActionType { get; private set; }

    public GovernancePolicy Policy { get; private set; } = null!;

    protected PolicyRule() { }

    public PolicyRule(Guid policyId, string targetResourceType, string conditionExpression, PolicyActionType actionType)
    {
        PolicyId = policyId;
        TargetResourceType = targetResourceType;
        ConditionExpression = conditionExpression;
        ActionType = actionType;
    }
}
