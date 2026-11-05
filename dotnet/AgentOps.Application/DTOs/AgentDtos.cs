using AgentOps.Domain.Enums;

namespace AgentOps.Application.DTOs;

public record RegisterAgentDto(string Name, string Role, string PublicKey, string OrganizationId, decimal DailyBudgetCapUsd);
public record AgentSummaryDto(Guid Id, string Name, string Role, string PublicKey, string OrganizationId, AgentStatus Status, decimal DailyBudgetCapUsd, decimal SpentTodayUsd);
public record AgentDetailDto(Guid Id, string Name, string Role, string PublicKey, string OrganizationId, AgentStatus Status, decimal DailyBudgetCapUsd, decimal SpentTodayUsd, List<ToolPermissionDto> Permissions);
public record ToolPermissionDto(Guid Id, string ToolName, decimal MaxSpendPerCallUsd, int RateLimitPerMinute, RiskLevel RiskLevel, bool IsEnabled);
public record GrantToolPermissionDto(string ToolName, decimal MaxSpendPerCallUsd, int RateLimitPerMinute, RiskLevel RiskLevel);
