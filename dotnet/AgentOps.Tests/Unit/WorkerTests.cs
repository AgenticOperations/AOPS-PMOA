using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Application.Services;
using AgentOps.Domain.Enums;
using AgentOps.Infrastructure.Persistence;
using AgentOps.Worker.BackgroundServices;
using Xunit;

namespace AgentOps.Tests.Unit;

public class WorkerTests
{
    [Fact]
    public async Task ProcessNext_WithEmptyQueue_ReturnsFalse()
    {
        var queue = new Mock<IAzureQueueService>();
        var worker = new ExecutionReconciliationWorker(NullLogger<ExecutionReconciliationWorker>.Instance, queue.Object,
            new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>());

        (await worker.ProcessNextAsync(CancellationToken.None)).Should().BeFalse();
    }

    [Fact]
    public async Task ProcessNext_SettlesTheDequeuedActionInItsOwnScope()
    {
        var dbName = Guid.NewGuid().ToString();
        ExecutionDispatchMessage message;
        using (var db = TestDb.Create(dbName))
        {
            var agent = TestDb.Agent(db);
            TestDb.Policy(db);
            var queueForRequest = new Mock<IAzureQueueService>();
            var result = await new ExecutionLifecycleService(db, new PolicyEvaluationService(db), queueForRequest.Object)
                .RequestExecutionAsync(new(agent.Id, "corr", "pay_invoice", "{}", 20m, RiskLevel.Low));
            message = new ExecutionDispatchMessage(result.Data!.SessionId, result.Data.Actions.Single().ActionId);
        }

        var services = new ServiceCollection();
        services.AddDbContext<AgentOpsDbContext>(o => o.UseInMemoryDatabase(dbName));
        services.AddScoped<IAgentOpsDbContext>(sp => sp.GetRequiredService<AgentOpsDbContext>());
        services.AddScoped<IExecutionReconciliationService, ExecutionReconciliationService>();
        var provider = services.BuildServiceProvider();

        var queue = new Mock<IAzureQueueService>();
        queue.Setup(q => q.DequeueMessageAsync<ExecutionDispatchMessage>(ExecutionDispatchMessage.QueueName, It.IsAny<CancellationToken>()))
            .ReturnsAsync(message);
        var worker = new ExecutionReconciliationWorker(NullLogger<ExecutionReconciliationWorker>.Instance, queue.Object,
            provider.GetRequiredService<IServiceScopeFactory>());

        (await worker.ProcessNextAsync(CancellationToken.None)).Should().BeTrue();

        using var verify = TestDb.Create(dbName);
        (await verify.ExecutionSessions.SingleAsync()).Status.Should().Be(ExecutionStatus.Completed);
    }
}
