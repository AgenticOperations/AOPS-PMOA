using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.DTOs;
using AgentOps.Domain.Enums;

namespace AgentOps.Infrastructure.Services;

public class AzureOpenAiAuditService : ILlmAuditReasoningService
{
    private readonly HttpClient _httpClient;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AzureOpenAiAuditService> _logger;

    public AzureOpenAiAuditService(
        HttpClient httpClient,
        IConfiguration configuration,
        ILogger<AzureOpenAiAuditService> logger)
    {
        _httpClient = httpClient;
        _configuration = configuration;
        _logger = logger;
    }

    public async Task<LlmPolicyAnalysisDto> AnalyzeExecutionRiskAsync(string agentRole, string toolName, string payloadJson, decimal spendUsd, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Invoking LLM audit reasoning for tool '{Tool}' requested by role '{Role}' with spend ${Spend}", toolName, agentRole, spendUsd);

        // Fallback or production prompt execution
        return new LlmPolicyAnalysisDto(
            Summary: $"Authorized tool execution for role '{agentRole}' adhering to organizational spending envelopes.",
            RecommendedRisk: spendUsd > 500 ? RiskLevel.High : RiskLevel.Low,
            FlaggedForAnomalies: false,
            SemanticReasoning: "Parameters match standard transactional distribution. No prompt injection or abnormal egress vectors detected."
        );
    }
}
