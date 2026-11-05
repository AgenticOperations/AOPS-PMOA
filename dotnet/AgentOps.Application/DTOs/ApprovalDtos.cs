using AgentOps.Domain.Enums;

namespace AgentOps.Application.DTOs;

public record PendingApprovalDto(Guid WorkflowId, Guid SessionId, Guid ActionId, string AgentName, string ToolName, decimal RequestedAmountUsd, DateTime CreatedAtUtc, DateTime ExpiresAtUtc);
public record SubmitApprovalDecisionDto(bool Approved, string Reason, string DecidedByUserId);
