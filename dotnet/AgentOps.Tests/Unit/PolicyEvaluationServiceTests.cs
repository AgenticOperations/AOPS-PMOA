using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;
using AgentOps.Domain.Entities;
using AgentOps.Domain.Enums;
using AgentOps.Infrastructure.Persistence;
using Xunit;

namespace AgentOps.Tests.Unit;

public class PolicyEvaluationServiceTests
{
    private AgentOpsDbContext CreateInMemoryDbContext()
    {
        var options = new DbContextOptionsBuilder<AgentOpsDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;
        return new AgentOpsDbContext(options);
    }

    [Fact]
    public async Task EvaluateExecutionAsync_WhenSpendExceedsThreshold_RequiresHumanApproval()
    {
        // Arrange
        using var context = CreateInMemoryDbContext();
        var service = new PolicyEvaluationService(context);

        var orgId = "test-org";
        var agent = new AgentIdentity("TradingBot-1", "Trader", "0x1234567890abcdef1234567890abcdef12345678", orgId, 1000m, "hash");
        agent.AddToolPermission("swapTokens", 500m, 10, RiskLevel.Moderate);
        context.AgentIdentities.Add(agent);

        var policy = new GovernancePolicy("OrgPolicy", "Test", orgId, RiskLevel.Moderate, 100m, false);
        context.GovernancePolicies.Add(policy);

        await context.SaveChangesAsync();

        var request = new EvaluateExecutionRequestDto(agent.Id, "swapTokens", "{}", 250m, RiskLevel.Moderate);

        // Act
        var result = await service.EvaluateExecutionAsync(request);

        // Assert
        result.Should().NotNull();
        result.IsAllowed.Should().BeFalse();
        result.ActionRequired.Should().Be(PolicyActionType.RequireHumanApproval);
    }

    [Fact]
    public async Task EvaluateExecutionAsync_WhenSpendWithinLimit_AllowsExecution()
    {
        // Arrange
        using var context = CreateInMemoryDbContext();
        var service = new PolicyEvaluationService(context);

        var orgId = "test-org";
        var agent = new AgentIdentity("WorkerBot", "Worker", "0xabcdef1234567890abcdef1234567890abcdef12", orgId, 500m, "hash");
        agent.AddToolPermission("queryData", 50m, 60, RiskLevel.Low);
        context.AgentIdentities.Add(agent);

        var policy = new GovernancePolicy("OrgPolicy", "Test", orgId, RiskLevel.Low, 100m, false);
        context.GovernancePolicies.Add(policy);

        await context.SaveChangesAsync();

        var request = new EvaluateExecutionRequestDto(agent.Id, "queryData", "{}", 10m, RiskLevel.Low);

        // Act
        var result = await service.EvaluateExecutionAsync(request);

        // Assert
        result.Should().NotNull();
        result.IsAllowed.Should().BeTrue();
        result.ActionRequired.Should().Be(PolicyActionType.Allow);
    }
}
