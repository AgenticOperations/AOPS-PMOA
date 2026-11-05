namespace AgentOps.Domain.Enums;

public enum ExecutionStatus
{
    Queued = 0,
    EvaluatingPolicy = 1,
    AwaitingApproval = 2,
    Executing = 3,
    Completed = 4,
    Failed = 5,
    BlockedByPolicy = 6
}
