namespace AgentOps.Domain.Enums;

public enum PolicyActionType
{
    Allow = 0,
    RequireHumanApproval = 1,
    RequireMultiSig = 2,
    Deny = 3
}
