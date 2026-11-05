using AgentOps.Domain.Enums;

namespace AgentOps.Application.DTOs;

public record CreatePolicyDto(string Name, string Description, string OrganizationId, RiskLevel MaxAllowedRiskLevel, decimal AutoApprovalSpendThresholdUsd, bool RequiresMultiSigForExternalTransfers);
public record PolicySummaryDto(Guid Id, string Name, string Description, string OrganizationId, RiskLevel MaxAllowedRiskLevel, decimal AutoApprovalSpendThresholdUsd, bool RequiresMultiSig, bool IsActive, int RuleCount);
public record EvaluateExecutionRequestDto(Guid AgentId, string ToolName, string PayloadJson, decimal RequestedSpendUsd, RiskLevel ActionRisk);
public record LlmPolicyAnalysisDto(string Summary, RiskLevel RecommendedRisk, bool FlaggedForAnomalies, string SemanticReasoning);
