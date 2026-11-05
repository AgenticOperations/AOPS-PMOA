namespace AgentOps.Domain.Exceptions;

public class PolicyViolationException : Exception
{
    public string PolicyName { get; }
    public string AgentId { get; }

    public PolicyViolationException(string policyName, string agentId, string message) 
        : base($"Policy violation '{policyName}' for agent '{agentId}': {message}")
    {
        PolicyName = policyName;
        AgentId = agentId;
    }
}
