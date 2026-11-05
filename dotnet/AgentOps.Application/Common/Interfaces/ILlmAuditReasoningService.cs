using AgentOps.Application.DTOs;

namespace AgentOps.Application.Common.Interfaces;

public interface ILlmAuditReasoningService
{
    Task<LlmPolicyAnalysisDto> AnalyzeExecutionRiskAsync(string agentRole, string toolName, string payloadJson, decimal spendUsd, CancellationToken cancellationToken = default);
}
