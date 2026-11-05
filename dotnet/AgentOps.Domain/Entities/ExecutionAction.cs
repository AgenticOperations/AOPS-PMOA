using AgentOps.Domain.Common;
using AgentOps.Domain.Enums;

namespace AgentOps.Domain.Entities;

public class ExecutionAction : BaseEntity
{
    public Guid SessionId { get; private set; }
    public string ToolName { get; private set; } = string.Empty;
    public string PayloadJson { get; private set; } = string.Empty;
    public decimal EstimatedSpendUsd { get; private set; }
    public RiskLevel RiskLevel { get; private set; }
    public ExecutionStatus Status { get; private set; }
    public string? ResultJson { get; private set; }
    public string? ErrorMessage { get; private set; }

    public ExecutionSession Session { get; private set; } = null!;

    protected ExecutionAction() { }

    public ExecutionAction(Guid sessionId, string toolName, string payloadJson, decimal estimatedSpendUsd, RiskLevel riskLevel)
    {
        SessionId = sessionId;
        ToolName = toolName;
        PayloadJson = payloadJson;
        EstimatedSpendUsd = estimatedSpendUsd;
        RiskLevel = riskLevel;
        Status = ExecutionStatus.Queued;
    }

    public void SetStatus(ExecutionStatus status, string? result = null, string? error = null)
    {
        Status = status;
        ResultJson = result;
        ErrorMessage = error;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}
