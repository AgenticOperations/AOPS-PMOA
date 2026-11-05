using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using AgentOps.Application.Common.Interfaces;

namespace AgentOps.Worker.BackgroundServices;

public class ExecutionReconciliationWorker : BackgroundService
{
    private readonly ILogger<ExecutionReconciliationWorker> _logger;
    private readonly IAzureQueueService _queueService;

    public ExecutionReconciliationWorker(
        ILogger<ExecutionReconciliationWorker> logger,
        IAzureQueueService queueService)
    {
        _logger = logger;
        _queueService = queueService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("AgentOps Execution Reconciliation Worker is initializing...");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var queuedItem = await _queueService.DequeueMessageAsync<dynamic>("agent-executions", stoppingToken);
                if (queuedItem != null)
                {
                    _logger.LogInformation("Consuming queued execution from Azure queue: {@Item}", queuedItem);
                    // Process async action and reconcile settlement state
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing execution queue batch.");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
