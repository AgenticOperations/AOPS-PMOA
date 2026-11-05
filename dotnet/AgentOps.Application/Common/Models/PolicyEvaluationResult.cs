using AgentOps.Domain.Enums;

namespace AgentOps.Application.Common.Models;

public record PolicyEvaluationResult(
    bool IsAllowed,
    PolicyActionType ActionRequired,
    string PolicyName,
    RiskLevel EvaluatedRisk,
    string Reasoning,
    List<string> AppliedRuleIds
);
