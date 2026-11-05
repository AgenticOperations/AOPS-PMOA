using AgentOps.Domain.Common;

namespace AgentOps.Domain.Entities;

public class AuditEvent : BaseEntity
{
    public string EventType { get; set; } = string.Empty;
    public Guid AgentId { get; set; }
    public Guid? SessionId { get; set; }
    public string OrganizationId { get; set; } = string.Empty;
    public string ActionName { get; set; } = string.Empty;
    public string DecisionPolicy { get; set; } = string.Empty;
    public decimal CapitalTransactedUsd { get; set; } = 0m;
    public string MerkleProofHash { get; set; } = string.Empty;
    public string RawEvidenceBlobUrl { get; set; } = string.Empty;
    public string Signature { get; set; } = string.Empty;
}
