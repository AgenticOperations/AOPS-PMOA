using System.Text.Json;
using Azure.Storage.Queues;
using Microsoft.Extensions.Configuration;
using AgentOps.Application.Common.Interfaces;

namespace AgentOps.Infrastructure.Services;

public class AzureQueueService : IAzureQueueService
{
    private readonly QueueServiceClient? _queueServiceClient;
    private readonly bool _useInMemoryFallback;
    private static readonly Dictionary<string, Queue<string>> _memoryQueues = new();

    public AzureQueueService(IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("AzureQueueStorage");
        if (!string.IsNullOrEmpty(connectionString))
        {
            _queueServiceClient = new QueueServiceClient(connectionString);
            _useInMemoryFallback = false;
        }
        else
        {
            _useInMemoryFallback = true;
        }
    }

    public async Task EnqueueMessageAsync<T>(string queueName, T message, CancellationToken cancellationToken = default)
    {
        var payload = JsonSerializer.Serialize(message);
        if (_useInMemoryFallback || _queueServiceClient == null)
        {
            lock (_memoryQueues)
            {
                if (!_memoryQueues.ContainsKey(queueName)) _memoryQueues[queueName] = new Queue<string>();
                _memoryQueues[queueName].Enqueue(payload);
            }
            await Task.CompletedTask;
            return;
        }

        var queueClient = _queueServiceClient.GetQueueClient(queueName);
        await queueClient.CreateIfNotExistsAsync(cancellationToken: cancellationToken);
        await queueClient.SendMessageAsync(Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payload)), cancellationToken);
    }

    public async Task<T?> DequeueMessageAsync<T>(string queueName, CancellationToken cancellationToken = default)
    {
        if (_useInMemoryFallback || _queueServiceClient == null)
        {
            lock (_memoryQueues)
            {
                if (_memoryQueues.TryGetValue(queueName, out var q) && q.Count > 0)
                {
                    return JsonSerializer.Deserialize<T>(q.Dequeue());
                }
            }
            await Task.CompletedTask;
            return default;
        }

        var queueClient = _queueServiceClient.GetQueueClient(queueName);
        if (!await queueClient.ExistsAsync(cancellationToken)) return default;

        var message = await queueClient.ReceiveMessageAsync(cancellationToken: cancellationToken);
        if (message.Value == null) return default;

        var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(message.Value.Body.ToString()));
        await queueClient.DeleteMessageAsync(message.Value.MessageId, message.Value.PopReceipt, cancellationToken);
        return JsonSerializer.Deserialize<T>(json);
    }
}
