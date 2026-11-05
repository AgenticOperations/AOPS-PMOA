using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Application.DTOs;
using AgentOps.Domain.Entities;
using System.Security.Cryptography;
using System.Text;

namespace AgentOps.Application.Services;

public interface IAgentRegistrationService
{
    Task<ServiceResult<AgentDetailDto>> RegisterAgentAsync(RegisterAgentDto dto, CancellationToken cancellationToken = default);
    Task<ServiceResult<List<AgentSummaryDto>>> GetAgentsByOrgAsync(string organizationId, CancellationToken cancellationToken = default);
    Task<ServiceResult<AgentDetailDto>> GetAgentByIdAsync(Guid agentId, CancellationToken cancellationToken = default);
    Task<ServiceResult<bool>> GrantToolPermissionAsync(Guid agentId, GrantToolPermissionDto dto, CancellationToken cancellationToken = default);
}

public class AgentRegistrationService : IAgentRegistrationService
{
    private readonly IAgentOpsDbContext _context;

    public AgentRegistrationService(IAgentOpsDbContext context)
    {
        _context = context;
    }

    public async Task<ServiceResult<AgentDetailDto>> RegisterAgentAsync(RegisterAgentDto dto, CancellationToken cancellationToken = default)
    {
        var existingKey = await _context.AgentIdentities.AnyAsync(a => a.PublicKey == dto.PublicKey, cancellationToken);
        if (existingKey) return ServiceResult<AgentDetailDto>.Failure("Agent with this public key is already registered.");

        var generatedApiKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var apiKeyHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(generatedApiKey)));

        var agent = new AgentIdentity(
            dto.Name,
            dto.Role,
            dto.PublicKey,
            dto.OrganizationId,
            dto.DailyBudgetCapUsd,
            apiKeyHash
        );

        _context.AgentIdentities.Add(agent);
        await _context.SaveChangesAsync(cancellationToken);

        return await GetAgentByIdAsync(agent.Id, cancellationToken);
    }

    public async Task<ServiceResult<List<AgentSummaryDto>>> GetAgentsByOrgAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        var agents = await _context.AgentIdentities
            .Where(a => a.OrganizationId == organizationId && !a.IsDeleted)
            .Select(a => new AgentSummaryDto(
                a.Id,
                a.Name,
                a.Role,
                a.PublicKey,
                a.OrganizationId,
                a.Status,
                a.DailyBudgetCapUsd,
                a.SpentTodayUsd
            ))
            .ToListAsync(cancellationToken);

        return ServiceResult<List<AgentSummaryDto>>.Success(agents);
    }

    public async Task<ServiceResult<AgentDetailDto>> GetAgentByIdAsync(Guid agentId, CancellationToken cancellationToken = default)
    {
        var agent = await _context.AgentIdentities
            .Include(a => a.ToolPermissions)
            .FirstOrDefaultAsync(a => a.Id == agentId, cancellationToken);

        if (agent == null) return ServiceResult<AgentDetailDto>.Failure("Agent not found.");

        var permissions = agent.ToolPermissions.Select(p => new ToolPermissionDto(
            p.Id,
            p.ToolName,
            p.MaxSpendPerCallUsd,
            p.RateLimitPerMinute,
            p.RiskLevel,
            p.IsEnabled
        )).ToList();

        var detail = new AgentDetailDto(
            agent.Id,
            agent.Name,
            agent.Role,
            agent.PublicKey,
            agent.OrganizationId,
            agent.Status,
            agent.DailyBudgetCapUsd,
            agent.SpentTodayUsd,
            permissions
        );

        return ServiceResult<AgentDetailDto>.Success(detail);
    }

    public async Task<ServiceResult<bool>> GrantToolPermissionAsync(Guid agentId, GrantToolPermissionDto dto, CancellationToken cancellationToken = default)
    {
        var agent = await _context.AgentIdentities
            .Include(a => a.ToolPermissions)
            .FirstOrDefaultAsync(a => a.Id == agentId, cancellationToken);

        if (agent == null) return ServiceResult<bool>.Failure("Agent not found.");

        agent.AddToolPermission(dto.ToolName, dto.MaxSpendPerCallUsd, dto.RateLimitPerMinute, dto.RiskLevel);
        await _context.SaveChangesAsync(cancellationToken);
        return ServiceResult<bool>.Success(true);
    }
}
