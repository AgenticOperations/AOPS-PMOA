using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Domain.Enums;

namespace AgentOps.Application.Services;

public enum ReconciliationOutcome
{
    Settled,
    BlockedOverBudget,
    AlreadyReconciled,
    NotFound
}

public interface IExecutionReconciliationService
{
    Task<ReconciliationOutcome> ReconcileAsync(ExecutionDispatchMessage message, CancellationToken cancellationToken = default);
}

/// <summary>
/// Settles an approved action. The daily budget is checked again at settlement time, because
/// other actions may have spent from it while this one waited in the queue or for a human.
/// Messages can be delivered more than once, so anything not in the Executing state is a no-op.
/// </summary>
public class ExecutionReconciliationService : IExecutionReconciliationService
{
    private readonly IAgentOpsDbContext _context;

    public ExecutionReconciliationService(IAgentOpsDbContext context)
    {
        _context = context;
    }

    public async Task<ReconciliationOutcome> ReconcileAsync(ExecutionDispatchMessage message, CancellationToken cancellationToken = default)
    {
        var session = await _context.ExecutionSessions
            .Include(s => s.Actions)
            .FirstOrDefaultAsync(s => s.Id == message.SessionId, cancellationToken);
        var action = session?.Actions.FirstOrDefault(a => a.Id == message.ActionId);
        if (session == null || action == null)
            return ReconciliationOutcome.NotFound;

        if (action.Status != ExecutionStatus.Executing)
            return ReconciliationOutcome.AlreadyReconciled;

        var agent = await _context.AgentIdentities.FirstOrDefaultAsync(a => a.Id == session.AgentId, cancellationToken);
        if (agent == null)
            return ReconciliationOutcome.NotFound;

        var now = DateTime.UtcNow;
        if (!agent.CanSpend(action.EstimatedSpendUsd))
        {
            const string reason = "Daily budget exhausted before settlement.";
            action.SetStatus(ExecutionStatus.BlockedByPolicy, null, reason);
            session.Fail(reason);
            _context.AuditEvents.Add(AuditEventFactory.Create("SettlementBlocked", agent.Id, agent.OrganizationId,
                session.Id, action.ToolName, "DailyBudgetExceeded", 0m, now));
            await _context.SaveChangesAsync(cancellationToken);
            return ReconciliationOutcome.BlockedOverBudget;
        }

        agent.RecordSpend(action.EstimatedSpendUsd);
        action.SetStatus(ExecutionStatus.Completed);

        if (session.Actions.All(a => a.Status is ExecutionStatus.Completed or ExecutionStatus.BlockedByPolicy or ExecutionStatus.Failed))
        {
            var settled = session.Actions.Where(a => a.Status == ExecutionStatus.Completed).Sum(a => a.EstimatedSpendUsd);
            session.Complete(settled);
        }

        _context.AuditEvents.Add(AuditEventFactory.Create("ExecutionSettled", agent.Id, agent.OrganizationId,
            session.Id, action.ToolName, "Settled", action.EstimatedSpendUsd, now));
        await _context.SaveChangesAsync(cancellationToken);
        return ReconciliationOutcome.Settled;
    }
}
