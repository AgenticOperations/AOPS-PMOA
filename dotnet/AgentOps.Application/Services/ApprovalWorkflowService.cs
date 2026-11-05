using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Application.DTOs;
using AgentOps.Domain.Enums;

namespace AgentOps.Application.Services;

public interface IApprovalWorkflowService
{
    Task<ServiceResult<List<PendingApprovalDto>>> GetPendingApprovalsAsync(CancellationToken cancellationToken = default);
    Task<ServiceResult<bool>> SubmitDecisionAsync(Guid workflowId, SubmitApprovalDecisionDto dto, CancellationToken cancellationToken = default);
}

public class ApprovalWorkflowService : IApprovalWorkflowService
{
    private readonly IAgentOpsDbContext _context;
    private readonly IAzureQueueService _queueService;

    public ApprovalWorkflowService(IAgentOpsDbContext context, IAzureQueueService queueService)
    {
        _context = context;
        _queueService = queueService;
    }

    public async Task<ServiceResult<List<PendingApprovalDto>>> GetPendingApprovalsAsync(CancellationToken cancellationToken = default)
    {
        var pending = await _context.ApprovalWorkflows
            .Where(w => w.State == ApprovalState.Pending && w.ExpiresAtUtc > DateTime.UtcNow)
            .OrderByDescending(w => w.CreatedAtUtc)
            .Select(w => new PendingApprovalDto(
                w.Id,
                w.SessionId,
                w.ActionId,
                "Agent Identity",
                "Tool Action",
                w.RequestedAmountUsd,
                w.CreatedAtUtc,
                w.ExpiresAtUtc
            ))
            .ToListAsync(cancellationToken);

        return ServiceResult<List<PendingApprovalDto>>.Success(pending);
    }

    public async Task<ServiceResult<bool>> SubmitDecisionAsync(Guid workflowId, SubmitApprovalDecisionDto dto, CancellationToken cancellationToken = default)
    {
        var workflow = await _context.ApprovalWorkflows.FindAsync(new object[] { workflowId }, cancellationToken);
        if (workflow == null) return ServiceResult<bool>.Failure("Workflow not found.");

        var session = await _context.ExecutionSessions.FindAsync(new object[] { workflow.SessionId }, cancellationToken);
        var action = await _context.ExecutionActions.FindAsync(new object[] { workflow.ActionId }, cancellationToken);

        try
        {
            if (dto.Approved)
            {
                workflow.Approve(dto.DecidedByUserId, dto.Reason);
                session?.MarkExecuting();
                action?.SetStatus(ExecutionStatus.Executing);
                await _queueService.EnqueueMessageAsync(ExecutionDispatchMessage.QueueName, new ExecutionDispatchMessage(workflow.SessionId, workflow.ActionId), cancellationToken);
            }
            else
            {
                workflow.Reject(dto.DecidedByUserId, dto.Reason);
                session?.Fail("Rejected by human supervisor: " + dto.Reason);
                action?.SetStatus(ExecutionStatus.BlockedByPolicy, null, "Human rejection: " + dto.Reason);
            }
        }
        catch (InvalidOperationException ex)
        {
            // An expired window flips the workflow to Expired before throwing; persist that, and fail the session.
            if (workflow.State == ApprovalState.Expired)
            {
                session?.Fail("Approval window expired.");
                action?.SetStatus(ExecutionStatus.BlockedByPolicy, null, "Approval window expired.");
                await _context.SaveChangesAsync(cancellationToken);
            }
            return ServiceResult<bool>.Failure(ex.Message);
        }

        await _context.SaveChangesAsync(cancellationToken);
        return ServiceResult<bool>.Success(true);
    }
}
