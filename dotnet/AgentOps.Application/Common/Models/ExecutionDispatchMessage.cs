namespace AgentOps.Application.Common.Models;

/// <summary>
/// Queue contract between the API, which approves an action, and the worker, which settles it.
/// </summary>
public record ExecutionDispatchMessage(Guid SessionId, Guid ActionId)
{
    public const string QueueName = "agent-executions";
}
