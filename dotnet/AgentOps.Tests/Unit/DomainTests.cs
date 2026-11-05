using FluentAssertions;
using AgentOps.Domain.Entities;
using AgentOps.Domain.Enums;
using Xunit;

namespace AgentOps.Tests.Unit;

public class DomainTests
{
    [Theory]
    [InlineData(50, RiskLevel.Low, PolicyActionType.Allow)]
    [InlineData(100, RiskLevel.Moderate, PolicyActionType.Allow)]
    [InlineData(100.01, RiskLevel.Moderate, PolicyActionType.RequireHumanApproval)]
    [InlineData(10, RiskLevel.Critical, PolicyActionType.Deny)]
    public void GovernancePolicy_EvaluateSpend(decimal spend, RiskLevel risk, PolicyActionType expected)
    {
        var policy = new GovernancePolicy("p", "", "acme", RiskLevel.High, 100m, false);
        policy.EvaluateSpend(spend, risk).Should().Be(expected);
    }

    [Fact]
    public void AgentIdentity_RejectsNegativeBudget()
    {
        var act = () => new AgentIdentity("a", "r", "k", "acme", -1m, "h");
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void AgentIdentity_CanSpendIsFalseOnceSuspended()
    {
        var agent = new AgentIdentity("a", "r", "k", "acme", 100m, "h");
        agent.CanSpend(100m).Should().BeTrue();
        agent.Suspend("incident");
        agent.CanSpend(1m).Should().BeFalse();
    }

    [Fact]
    public void AgentIdentity_GrantingSameToolTwiceUpdatesLimits()
    {
        var agent = new AgentIdentity("a", "r", "k", "acme", 100m, "h");
        agent.AddToolPermission("pay", 10m, 5, RiskLevel.Low);
        agent.AddToolPermission("PAY", 20m, 5, RiskLevel.Moderate);

        agent.ToolPermissions.Should().ContainSingle().Which.MaxSpendPerCallUsd.Should().Be(20m);
    }

    [Fact]
    public void ApprovalWorkflow_CannotBeDecidedTwice()
    {
        var workflow = new ApprovalWorkflow(Guid.NewGuid(), Guid.NewGuid(), 10m, TimeSpan.FromHours(1));
        workflow.Approve("cfo", "ok");

        workflow.Invoking(w => w.Reject("cfo", "changed my mind")).Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void ApprovalWorkflow_ApprovingAfterExpiry_MarksExpired()
    {
        var workflow = new ApprovalWorkflow(Guid.NewGuid(), Guid.NewGuid(), 10m, TimeSpan.FromMinutes(-1));

        workflow.Invoking(w => w.Approve("cfo", "late")).Should().Throw<InvalidOperationException>();
        workflow.State.Should().Be(ApprovalState.Expired);
    }
}
