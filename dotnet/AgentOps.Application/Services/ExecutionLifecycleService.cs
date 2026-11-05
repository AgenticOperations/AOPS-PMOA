using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Application.DTOs;
using AgentOps.Domain.Entities;
using AgentOps.Domain.Enums;

namespace AgentOps.Application.Services;

public interface IExecutionLifecycleService
{
    Task<ServiceResult<ExecutionSessionStatusDto>> RequestExecutionAsync(RequestExecutionDto dto, CancellationToken cancellationToken = default);
    Task<ServiceResult<ExecutionSessionStatusDto>> GetSessionStatusAsync(Guid sessionId, CancellationToken cancellationToken = default);
}

public class ExecutionLifecycleService : IExecutionLifecycleService
{
    private readonly IAgentOpsDbContext _context;
    private readonly IPolicyEvaluationService _policyService;
    private readonly IAzureQueueService _queueService;

    public ExecutionLifecycleService(
        IAgentOpsDbContext context,
        IPolicyEvaluationService policyService,
        IAzureQueueService queueService)
    {
        _context = context;
        _policyService = policyService;
        _queueService = queueService;
    }

    public async Task<ServiceResult<ExecutionSessionStatusDto>> RequestExecutionAsync(RequestExecutionDto dto, CancellationToken cancellationToken = default)
    {
        var session = new ExecutionSession(dto.AgentId, dto.SessionCorrelationId);
        _context.ExecutionSessions.Add(session);

        var action = session.PlanAction(dto.ToolName, dto.PayloadJson, dto.EstimatedSpendUsd, dto.RiskLevel);
        session.MarkEvaluating();
        await _context.SaveChangesAsync(cancellationToken);

        // Evaluate Policy
        var evalRequest = new EvaluateExecutionRequestDto(dto.AgentId, dto.ToolName, dto.PayloadJson, dto.EstimatedSpendUsd, dto.RiskLevel);
        var evalResult = await _policyService.EvaluateExecutionAsync(evalRequest, cancellationToken);

        if (!evalResult.IsAllowed)
        {
            if (evalResult.ActionRequired == PolicyActionType.RequireHumanApproval || evalResult.ActionRequired == PolicyActionType.RequireMultiSig)
            {
                session.MarkAwaitingApproval();
                var approval = new ApprovalWorkflow(session.Id, action.Id, dto.EstimatedSpendUsd, TimeSpan.FromHours(24));
                _context.ApprovalWorkflows.Add(approval);
            }
            else
            {
                action.SetStatus(ExecutionStatus.BlockedByPolicy, null, evalResult.Reasoning);
                session.Fail(evalResult.Reasoning);
                var organizationId = await _context.AgentIdentities
                    .Where(a => a.Id == dto.AgentId).Select(a => a.OrganizationId)
                    .FirstOrDefaultAsync(cancellationToken) ?? "unknown";
                _context.AuditEvents.Add(AuditEventFactory.Create("ExecutionDenied", dto.AgentId, organizationId,
                    session.Id, dto.ToolName, evalResult.PolicyName, 0m, DateTime.UtcNow));
            }
        }
        else
        {
            session.MarkExecuting();
            action.SetStatus(ExecutionStatus.Executing);
            // Settlement happens in the worker, which consumes this from Azure Queue Storage.
            await _queueService.EnqueueMessageAsync(ExecutionDispatchMessage.QueueName, new ExecutionDispatchMessage(session.Id, action.Id), cancellationToken);
        }

        await _context.SaveChangesAsync(cancellationToken);
        return await GetSessionStatusAsync(session.Id, cancellationToken);
    }

    public async Task<ServiceResult<ExecutionSessionStatusDto>> GetSessionStatusAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        var session = await _context.ExecutionSessions
            .Include(s => s.Actions)
            .FirstOrDefaultAsync(s => s.Id == sessionId, cancellationToken);

        if (session == null) return ServiceResult<ExecutionSessionStatusDto>.Failure("Execution session not found.");

        var actions = session.Actions.Select(a => new ExecutionActionDto(
            a.Id,
            a.ToolName,
            a.EstimatedSpendUsd,
            a.RiskLevel,
            a.Status,
            a.ErrorMessage
        )).ToList();

        var dto = new ExecutionSessionStatusDto(
            session.Id,
            session.AgentId,
            session.SessionCorrelationId,
            session.Status,
            session.TotalExecutedSpendUsd,
            actions
        );

        return ServiceResult<ExecutionSessionStatusDto>.Success(dto);
    }
}
