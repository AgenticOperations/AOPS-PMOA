namespace AgentOps.Domain.Exceptions;

public class UnauthorizedToolException : Exception
{
    public UnauthorizedToolException(string toolName, string agentId) 
        : base($"Agent '{agentId}' is not authorized to invoke tool '{toolName}'.")
    {
    }
}
