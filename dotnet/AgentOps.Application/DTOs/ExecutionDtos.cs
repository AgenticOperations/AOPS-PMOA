using AgentOps.Domain.Enums;

namespace AgentOps.Application.DTOs;

public record RequestExecutionDto(Guid AgentId, string SessionCorrelationId, string ToolName, string PayloadJson, decimal EstimatedSpendUsd, RiskLevel RiskLevel);
public record ExecutionSessionStatusDto(Guid SessionId, Guid AgentId, string CorrelationId, ExecutionStatus Status, decimal TotalSpendUsd, List<ExecutionActionDto> Actions);
public record ExecutionActionDto(Guid ActionId, string ToolName, decimal EstimatedSpendUsd, RiskLevel RiskLevel, ExecutionStatus Status, string? ErrorMessage);
