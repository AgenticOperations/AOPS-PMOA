using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Common.Models;
using AgentOps.Application.Services;

namespace AgentOps.Worker.BackgroundServices;

/// <summary>
/// Drains the execution queue and settles each action in its own DI scope (one DbContext per message).
/// Polls quickly while there is work and backs off to <see cref="IdleDelay"/> when the queue is empty.
/// </summary>
public class ExecutionReconciliationWorker : BackgroundService
{
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(5);

    private readonly ILogger<ExecutionReconciliationWorker> _logger;
    private readonly IAzureQueueService _queueService;
    private readonly IServiceScopeFactory _scopeFactory;

    public ExecutionReconciliationWorker(
        ILogger<ExecutionReconciliationWorker> logger,
        IAzureQueueService queueService,
        IServiceScopeFactory scopeFactory)
    {
        _logger = logger;
        _queueService = queueService;
        _scopeFactory = scopeFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Execution reconciliation worker started on queue {Queue}", ExecutionDispatchMessage.QueueName);

        while (!stoppingToken.IsCancellationRequested)
        {
            var processed = false;
            try
            {
                processed = await ProcessNextAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to reconcile a queued execution");
            }

            if (!processed)
                await Task.Delay(IdleDelay, stoppingToken);
        }
    }

    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken)
    {
        var message = await _queueService.DequeueMessageAsync<ExecutionDispatchMessage>(ExecutionDispatchMessage.QueueName, cancellationToken);
        if (message == null)
            return false;

        using var scope = _scopeFactory.CreateScope();
        var reconciler = scope.ServiceProvider.GetRequiredService<IExecutionReconciliationService>();
        var outcome = await reconciler.ReconcileAsync(message, cancellationToken);

        _logger.LogInformation("Session {SessionId} action {ActionId}: {Outcome}", message.SessionId, message.ActionId, outcome);
        return true;
    }
}
