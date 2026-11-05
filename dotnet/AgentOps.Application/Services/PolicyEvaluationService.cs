using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Application.DTOs;
using AgentOps.Domain.Enums;
using AgentOps.Domain.Entities;

namespace AgentOps.Application.Services;

public interface IPolicyEvaluationService
{
    Task<ServiceResult<PolicySummaryDto>> CreatePolicyAsync(CreatePolicyDto dto, CancellationToken cancellationToken = default);
    Task<ServiceResult<List<PolicySummaryDto>>> GetPoliciesAsync(string organizationId, CancellationToken cancellationToken = default);
    Task<PolicyEvaluationResult> EvaluateExecutionAsync(EvaluateExecutionRequestDto request, CancellationToken cancellationToken = default);
}

public class PolicyEvaluationService : IPolicyEvaluationService
{
    private readonly IAgentOpsDbContext _context;

    public PolicyEvaluationService(IAgentOpsDbContext context)
    {
        _context = context;
    }

    public async Task<ServiceResult<PolicySummaryDto>> CreatePolicyAsync(CreatePolicyDto dto, CancellationToken cancellationToken = default)
    {
        var policy = new GovernancePolicy(
            dto.Name,
            dto.Description,
            dto.OrganizationId,
            dto.MaxAllowedRiskLevel,
            dto.AutoApprovalSpendThresholdUsd,
            dto.RequiresMultiSigForExternalTransfers
        );

        _context.GovernancePolicies.Add(policy);
        await _context.SaveChangesAsync(cancellationToken);

        var summary = new PolicySummaryDto(
            policy.Id,
            policy.Name,
            policy.Description,
            policy.OrganizationId,
            policy.MaxAllowedRiskLevel,
            policy.AutoApprovalSpendThresholdUsd,
            policy.RequiresMultiSigForExternalTransfers,
            policy.IsActive,
            0
        );

        return ServiceResult<PolicySummaryDto>.Success(summary);
    }

    public async Task<ServiceResult<List<PolicySummaryDto>>> GetPoliciesAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        var policies = await _context.GovernancePolicies
            .Include(p => p.Rules)
            .Where(p => p.OrganizationId == organizationId && !p.IsDeleted)
            .Select(p => new PolicySummaryDto(
                p.Id,
                p.Name,
                p.Description,
                p.OrganizationId,
                p.MaxAllowedRiskLevel,
                p.AutoApprovalSpendThresholdUsd,
                p.RequiresMultiSigForExternalTransfers,
                p.IsActive,
                p.Rules.Count
            ))
            .ToListAsync(cancellationToken);

        return ServiceResult<List<PolicySummaryDto>>.Success(policies);
    }

    public async Task<PolicyEvaluationResult> EvaluateExecutionAsync(EvaluateExecutionRequestDto request, CancellationToken cancellationToken = default)
    {
        var agent = await _context.AgentIdentities
            .Include(a => a.ToolPermissions)
            .FirstOrDefaultAsync(a => a.Id == request.AgentId, cancellationToken);

        if (agent == null)
        {
            return new PolicyEvaluationResult(false, PolicyActionType.Deny, "AgentNotFound", request.ActionRisk, "Agent identity is not recognized.", new());
        }

        if (agent.Status != AgentStatus.Active)
        {
            return new PolicyEvaluationResult(false, PolicyActionType.Deny, "AgentSuspended", request.ActionRisk, "Agent identity is suspended or revoked.", new());
        }

        var permission = agent.ToolPermissions.FirstOrDefault(p => p.ToolName.Equals(request.ToolName, StringComparison.OrdinalIgnoreCase) && p.IsEnabled);
        if (permission == null)
        {
            return new PolicyEvaluationResult(false, PolicyActionType.Deny, "ToolNotPermitted", request.ActionRisk, $"Tool '{request.ToolName}' has not been authorized for this agent.", new());
        }

        if (request.RequestedSpendUsd > permission.MaxSpendPerCallUsd)
        {
            return new PolicyEvaluationResult(false, PolicyActionType.Deny, "SpendPerCallExceeded", request.ActionRisk, $"Requested spend ${request.RequestedSpendUsd} exceeds per-call limit ${permission.MaxSpendPerCallUsd}.", new());
        }

        if (!agent.CanSpend(request.RequestedSpendUsd))
        {
            return new PolicyEvaluationResult(false, PolicyActionType.Deny, "DailyBudgetExceeded", request.ActionRisk, $"Requested spend ${request.RequestedSpendUsd} exceeds daily budget cap ${agent.DailyBudgetCapUsd}.", new());
        }

        var policy = await _context.GovernancePolicies
            .FirstOrDefaultAsync(p => p.OrganizationId == agent.OrganizationId && p.IsActive, cancellationToken);

        if (policy == null)
        {
            return new PolicyEvaluationResult(true, PolicyActionType.Allow, "DefaultAllow", request.ActionRisk, "No explicit policy overrides. Proceeding under default bounds.", new());
        }

        var actionRequired = policy.EvaluateSpend(request.RequestedSpendUsd, request.ActionRisk);

        return new PolicyEvaluationResult(
            IsAllowed: actionRequired == PolicyActionType.Allow,
            ActionRequired: actionRequired,
            PolicyName: policy.Name,
            EvaluatedRisk: request.ActionRisk,
            Reasoning: actionRequired == PolicyActionType.Allow ? "Complies with organizational governance thresholds." : $"Requires {actionRequired} state transition.",
            AppliedRuleIds: new List<string> { policy.Id.ToString() }
        );
    }
}
