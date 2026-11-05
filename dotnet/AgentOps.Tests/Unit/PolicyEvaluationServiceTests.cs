using FluentAssertions;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;
using AgentOps.Domain.Enums;
using Xunit;

namespace AgentOps.Tests.Unit;

public class PolicyEvaluationServiceTests
{
    private static EvaluateExecutionRequestDto Req(Guid agentId, decimal spend, RiskLevel risk = RiskLevel.Low, string tool = "pay_invoice") =>
        new(agentId, tool, "{}", spend, risk);

    [Fact]
    public async Task WhenSpendWithinThreshold_Allows()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db);
        TestDb.Policy(db);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 50m));

        result.IsAllowed.Should().BeTrue();
        result.ActionRequired.Should().Be(PolicyActionType.Allow);
    }

    [Fact]
    public async Task WhenSpendAboveThreshold_RequiresHumanApproval()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db);
        TestDb.Policy(db, autoApprove: 100m);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 250m));

        result.IsAllowed.Should().BeFalse();
        result.ActionRequired.Should().Be(PolicyActionType.RequireHumanApproval);
    }

    [Fact]
    public async Task WhenPolicyRequiresMultiSig_EscalatesToMultiSig()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db);
        TestDb.Policy(db, autoApprove: 100m, multiSig: true);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 250m));

        result.ActionRequired.Should().Be(PolicyActionType.RequireMultiSig);
    }

    [Fact]
    public async Task WhenNoActivePolicy_FailsClosed()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 1m));

        result.IsAllowed.Should().BeFalse();
        result.ActionRequired.Should().Be(PolicyActionType.Deny);
        result.PolicyName.Should().Be("NoActivePolicy");
    }

    [Fact]
    public async Task WhenAgentUnknown_Denies()
    {
        using var db = TestDb.Create();
        TestDb.Policy(db);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(Guid.NewGuid(), 1m));

        result.PolicyName.Should().Be("AgentNotFound");
        result.IsAllowed.Should().BeFalse();
    }

    [Fact]
    public async Task WhenAgentSuspended_Denies()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db);
        TestDb.Policy(db);
        agent.Suspend("key rotation");
        await db.SaveChangesAsync();

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 1m));

        result.PolicyName.Should().Be("AgentSuspended");
    }

    [Fact]
    public async Task WhenToolNotGranted_Denies()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db);
        TestDb.Policy(db);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 1m, tool: "wire_transfer"));

        result.PolicyName.Should().Be("ToolNotPermitted");
    }

    [Fact]
    public async Task WhenActionRiskAboveToolCeiling_Denies()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db, toolRisk: RiskLevel.Moderate);
        TestDb.Policy(db);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 1m, RiskLevel.High));

        result.PolicyName.Should().Be("ToolRiskCeilingExceeded");
    }

    [Fact]
    public async Task WhenPerCallLimitExceeded_DeniesBeforePolicy()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db, perCall: 500m);
        TestDb.Policy(db);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 501m));

        result.PolicyName.Should().Be("SpendPerCallExceeded");
    }

    [Fact]
    public async Task WhenDailyBudgetWouldBeExceeded_Denies()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db, dailyCap: 100m);
        TestDb.Policy(db);
        agent.RecordSpend(90m);
        await db.SaveChangesAsync();

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 20m));

        result.PolicyName.Should().Be("DailyBudgetExceeded");
    }

    [Fact]
    public async Task WhenRiskAbovePolicyMaximum_Denies()
    {
        using var db = TestDb.Create();
        var agent = TestDb.Agent(db, toolRisk: RiskLevel.Critical);
        TestDb.Policy(db, maxRisk: RiskLevel.Moderate);

        var result = await new PolicyEvaluationService(db).EvaluateExecutionAsync(Req(agent.Id, 1m, RiskLevel.High));

        result.ActionRequired.Should().Be(PolicyActionType.Deny);
        result.PolicyName.Should().Be("Treasury policy");
    }
}
