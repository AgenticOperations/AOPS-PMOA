using AgentOps.Domain.Common;
using AgentOps.Domain.Enums;

namespace AgentOps.Domain.Entities;

public class ExecutionSession : BaseEntity, IAggregateRoot
{
    public Guid AgentId { get; private set; }
    public string SessionCorrelationId { get; private set; } = string.Empty;
    public ExecutionStatus Status { get; private set; }
    public DateTime? CompletedAtUtc { get; private set; }
    public decimal TotalExecutedSpendUsd { get; private set; } = 0m;

    public AgentIdentity Agent { get; private set; } = null!;

    private readonly List<ExecutionAction> _actions = new();
    public IReadOnlyCollection<ExecutionAction> Actions => _actions.AsReadOnly();

    protected ExecutionSession() { }

    public ExecutionSession(Guid agentId, string correlationId)
    {
        AgentId = agentId;
        SessionCorrelationId = correlationId;
        Status = ExecutionStatus.Queued;
    }

    public ExecutionAction PlanAction(string toolName, string payloadJson, decimal estimatedSpendUsd, RiskLevel riskLevel)
    {
        var action = new ExecutionAction(Id, toolName, payloadJson, estimatedSpendUsd, riskLevel);
        _actions.Add(action);
        UpdatedAtUtc = DateTime.UtcNow;
        return action;
    }

    public void MarkEvaluating()
    {
        Status = ExecutionStatus.EvaluatingPolicy;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void MarkAwaitingApproval()
    {
        Status = ExecutionStatus.AwaitingApproval;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void MarkExecuting()
    {
        Status = ExecutionStatus.Executing;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void Complete(decimal finalSpendUsd)
    {
        Status = ExecutionStatus.Completed;
        TotalExecutedSpendUsd = finalSpendUsd;
        CompletedAtUtc = DateTime.UtcNow;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void Fail(string reason)
    {
        Status = ExecutionStatus.Failed;
        CompletedAtUtc = DateTime.UtcNow;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}
