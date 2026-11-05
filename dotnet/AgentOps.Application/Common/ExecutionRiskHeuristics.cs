using System.Text.Json;
using AgentOps.Application.DTOs;
using AgentOps.Domain.Enums;

namespace AgentOps.Application.Common;

/// <summary>
/// Deterministic risk screen for a requested tool call. It runs on every request and is the
/// floor for the language model review: the model can raise the risk level, never lower it.
/// </summary>
public static class ExecutionRiskHeuristics
{
    private static readonly string[] InjectionMarkers =
    {
        "ignore previous", "ignore all previous", "disregard the above", "system prompt", "you are now"
    };

    public static LlmPolicyAnalysisDto Assess(string agentRole, string toolName, string payloadJson, decimal spendUsd)
    {
        var signals = new List<string>();
        var risk = spendUsd switch
        {
            >= 10_000m => RiskLevel.Critical,
            >= 1_000m => RiskLevel.High,
            >= 100m => RiskLevel.Moderate,
            _ => RiskLevel.Low
        };
        if (risk > RiskLevel.Low)
            signals.Add($"spend ${spendUsd:0.##} is in the {risk} band");

        var payload = payloadJson ?? string.Empty;
        if (!IsValidJson(payload))
        {
            signals.Add("payload is not valid JSON");
            risk = Max(risk, RiskLevel.High);
        }

        var lowered = payload.ToLowerInvariant();
        var marker = InjectionMarkers.FirstOrDefault(lowered.Contains);
        if (marker != null)
        {
            signals.Add($"payload contains instruction-like text (\"{marker}\")");
            risk = RiskLevel.Critical;
        }

        var flagged = marker != null || risk >= RiskLevel.High;
        var reasoning = signals.Count == 0
            ? "No risk signals: spend is in the low band and the payload is well-formed JSON."
            : "Signals: " + string.Join("; ", signals) + ".";

        return new LlmPolicyAnalysisDto($"{agentRole} requested '{toolName}' for ${spendUsd:0.##}.", risk, flagged, reasoning);
    }

    public static RiskLevel Max(RiskLevel a, RiskLevel b) => a > b ? a : b;

    private static bool IsValidJson(string payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return false;
        try
        {
            using var _ = JsonDocument.Parse(payload);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
