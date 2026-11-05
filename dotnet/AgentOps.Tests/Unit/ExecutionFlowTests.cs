using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Moq;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;
using AgentOps.Domain.Entities;
using AgentOps.Domain.Enums;
using AgentOps.Infrastructure.Persistence;
using Xunit;

namespace AgentOps.Tests.Unit;

public class ExecutionFlowTests
{
    private readonly AgentOpsDbContext _db = TestDb.Create();
    private readonly Mock<IAzureQueueService> _queue = new();

    private ExecutionLifecycleService Lifecycle() => new(_db, new PolicyEvaluationService(_db), _queue.Object);

    private static RequestExecutionDto Request(Guid agentId, decimal spend, RiskLevel risk = RiskLevel.Low, string tool = "pay_invoice") =>
        new(agentId, "corr-1", tool, "{\"invoice\":\"INV-7\"}", spend, risk);

    [Fact]
    public async Task AllowedRequest_IsMarkedExecutingAndDispatchedToTheQueue()
    {
        var agent = TestDb.Agent(_db);
        TestDb.Policy(_db);

        var result = await Lifecycle().RequestExecutionAsync(Request(agent.Id, 40m));

        result.Data!.Status.Should().Be(ExecutionStatus.Executing);
        var actionId = result.Data.Actions.Single().ActionId;
        _queue.Verify(q => q.EnqueueMessageAsync(ExecutionDispatchMessage.QueueName,
            new ExecutionDispatchMessage(result.Data.SessionId, actionId), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DeniedRequest_FailsSessionWritesHashedAuditAndNeverEnqueues()
    {
        var agent = TestDb.Agent(_db);
        TestDb.Policy(_db);

        var result = await Lifecycle().RequestExecutionAsync(Request(agent.Id, 10m, tool: "wire_transfer"));

        result.Data!.Status.Should().Be(ExecutionStatus.Failed);
        result.Data.Actions.Single().Status.Should().Be(ExecutionStatus.BlockedByPolicy);
        var audit = await _db.AuditEvents.SingleAsync();
        audit.EventType.Should().Be("ExecutionDenied");
        audit.DecisionPolicy.Should().Be("ToolNotPermitted");
        audit.OrganizationId.Should().Be(TestDb.Org);
        Application.Common.AuditEventFactory.Verify(audit).Should().BeTrue();
        _queue.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task RequestAboveThreshold_OpensApprovalWorkflowInsteadOfExecuting()
    {
        var agent = TestDb.Agent(_db);
        TestDb.Policy(_db, autoApprove: 100m);

        var result = await Lifecycle().RequestExecutionAsync(Request(agent.Id, 300m));

        result.Data!.Status.Should().Be(ExecutionStatus.AwaitingApproval);
        var workflow = await _db.ApprovalWorkflows.SingleAsync();
        workflow.RequestedAmountUsd.Should().Be(300m);
        workflow.State.Should().Be(ApprovalState.Pending);
        _queue.VerifyNoOtherCalls();
    }

    private async Task<ApprovalWorkflow> PendingApproval()
    {
        var agent = TestDb.Agent(_db);
        TestDb.Policy(_db, autoApprove: 100m);
        await Lifecycle().RequestExecutionAsync(Request(agent.Id, 300m));
        return await _db.ApprovalWorkflows.SingleAsync();
    }

    [Fact]
    public async Task ApprovingAWorkflow_ResumesExecutionAndDispatches()
    {
        var workflow = await PendingApproval();

        var result = await new ApprovalWorkflowService(_db, _queue.Object)
            .SubmitDecisionAsync(workflow.Id, new SubmitApprovalDecisionDto(true, "Vendor verified", "cfo"));

        result.Succeeded.Should().BeTrue();
        (await _db.ExecutionSessions.SingleAsync()).Status.Should().Be(ExecutionStatus.Executing);
        _queue.Verify(q => q.EnqueueMessageAsync(ExecutionDispatchMessage.QueueName,
            new ExecutionDispatchMessage(workflow.SessionId, workflow.ActionId), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RejectingAWorkflow_BlocksTheActionAndFailsTheSession()
    {
        var workflow = await PendingApproval();

        var service = new ApprovalWorkflowService(_db, _queue.Object);
        var result = await service.SubmitDecisionAsync(workflow.Id, new SubmitApprovalDecisionDto(false, "Unknown vendor", "cfo"));

        result.Succeeded.Should().BeTrue();
        (await _db.ExecutionSessions.SingleAsync()).Status.Should().Be(ExecutionStatus.Failed);
        (await _db.ExecutionActions.SingleAsync()).Status.Should().Be(ExecutionStatus.BlockedByPolicy);
        (await service.SubmitDecisionAsync(workflow.Id, new SubmitApprovalDecisionDto(true, "retry", "cfo")))
            .Succeeded.Should().BeFalse("a decided workflow cannot be decided again");
        _queue.VerifyNoOtherCalls();
    }

    private async Task<ExecutionDispatchMessage> ExecutingAction(decimal spend, decimal dailyCap = 1000m)
    {
        var agent = TestDb.Agent(_db, dailyCap: dailyCap);
        TestDb.Policy(_db, autoApprove: 1000m);
        var result = await Lifecycle().RequestExecutionAsync(Request(agent.Id, spend));
        return new ExecutionDispatchMessage(result.Data!.SessionId, result.Data.Actions.Single().ActionId);
    }

    [Fact]
    public async Task Reconcile_SettlesRecordsSpendAndCompletesTheSession()
    {
        var message = await ExecutingAction(75m);

        var outcome = await new ExecutionReconciliationService(_db).ReconcileAsync(message);

        outcome.Should().Be(ReconciliationOutcome.Settled);
        var session = await _db.ExecutionSessions.SingleAsync();
        session.Status.Should().Be(ExecutionStatus.Completed);
        session.TotalExecutedSpendUsd.Should().Be(75m);
        (await _db.AgentIdentities.SingleAsync()).SpentTodayUsd.Should().Be(75m);
        (await _db.AuditEvents.SingleAsync()).EventType.Should().Be("ExecutionSettled");
    }

    [Fact]
    public async Task Reconcile_IsIdempotentForARedeliveredMessage()
    {
        var message = await ExecutingAction(75m);
        var service = new ExecutionReconciliationService(_db);

        await service.ReconcileAsync(message);
        var second = await service.ReconcileAsync(message);

        second.Should().Be(ReconciliationOutcome.AlreadyReconciled);
        (await _db.AgentIdentities.SingleAsync()).SpentTodayUsd.Should().Be(75m, "a redelivered message must not charge twice");
    }

    [Fact]
    public async Task Reconcile_RechecksBudgetAtSettlementTime()
    {
        var message = await ExecutingAction(80m, dailyCap: 100m);
        var agent = await _db.AgentIdentities.SingleAsync();
        agent.RecordSpend(50m); // another session settled in between
        await _db.SaveChangesAsync();

        var outcome = await new ExecutionReconciliationService(_db).ReconcileAsync(message);

        outcome.Should().Be(ReconciliationOutcome.BlockedOverBudget);
        (await _db.ExecutionActions.SingleAsync()).Status.Should().Be(ExecutionStatus.BlockedByPolicy);
        (await _db.ExecutionSessions.SingleAsync()).Status.Should().Be(ExecutionStatus.Failed);
        (await _db.AuditEvents.SingleAsync()).EventType.Should().Be("SettlementBlocked");
        agent.SpentTodayUsd.Should().Be(50m);
    }

    [Fact]
    public async Task Reconcile_UnknownSession_ReturnsNotFound()
    {
        var outcome = await new ExecutionReconciliationService(_db)
            .ReconcileAsync(new ExecutionDispatchMessage(Guid.NewGuid(), Guid.NewGuid()));

        outcome.Should().Be(ReconciliationOutcome.NotFound);
    }
}
