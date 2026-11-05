namespace AgentOps.Application.Common.Interfaces;

public interface IAzureQueueService
{
    Task EnqueueMessageAsync<T>(string queueName, T message, CancellationToken cancellationToken = default);
    Task<T?> DequeueMessageAsync<T>(string queueName, CancellationToken cancellationToken = default);
}
