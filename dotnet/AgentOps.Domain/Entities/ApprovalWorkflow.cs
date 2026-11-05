using AgentOps.Domain.Common;
using AgentOps.Domain.Enums;

namespace AgentOps.Domain.Entities;

public class ApprovalWorkflow : BaseEntity, IAggregateRoot
{
    public Guid SessionId { get; private set; }
    public Guid ActionId { get; private set; }
    public decimal RequestedAmountUsd { get; private set; }
    public ApprovalState State { get; private set; }
    public string? ApprovedByUserId { get; private set; }
    public DateTime? DecidedAtUtc { get; private set; }
    public DateTime ExpiresAtUtc { get; private set; }
    public string? DecisionReason { get; private set; }

    protected ApprovalWorkflow() { }

    public ApprovalWorkflow(Guid sessionId, Guid actionId, decimal amountUsd, TimeSpan expiryWindow)
    {
        SessionId = sessionId;
        ActionId = actionId;
        RequestedAmountUsd = amountUsd;
        State = ApprovalState.Pending;
        ExpiresAtUtc = DateTime.UtcNow.Add(expiryWindow);
    }

    public void Approve(string userId, string reason)
    {
        if (State != ApprovalState.Pending) throw new InvalidOperationException("Workflow is not in a pending state.");
        if (DateTime.UtcNow > ExpiresAtUtc)
        {
            State = ApprovalState.Expired;
            throw new InvalidOperationException("Approval window has expired.");
        }

        State = ApprovalState.Approved;
        ApprovedByUserId = userId;
        DecisionReason = reason;
        DecidedAtUtc = DateTime.UtcNow;
        UpdatedAtUtc = DateTime.UtcNow;
    }

    public void Reject(string userId, string reason)
    {
        if (State != ApprovalState.Pending) throw new InvalidOperationException("Workflow is not in a pending state.");

        State = ApprovalState.Rejected;
        ApprovedByUserId = userId;
        DecisionReason = reason;
        DecidedAtUtc = DateTime.UtcNow;
        UpdatedAtUtc = DateTime.UtcNow;
    }
}
