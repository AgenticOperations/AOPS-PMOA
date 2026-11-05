using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using AgentOps.Domain.Entities;

namespace AgentOps.Application.Common;

/// <summary>
/// Builds audit events with a SHA-256 digest over their decision fields, so a row that is
/// edited after the fact no longer matches its own hash.
/// </summary>
public static class AuditEventFactory
{
    public static AuditEvent Create(string eventType, Guid agentId, string organizationId, Guid? sessionId,
        string actionName, string decisionPolicy, decimal capitalUsd, DateTime occurredAtUtc)
    {
        var audit = new AuditEvent
        {
            EventType = eventType,
            AgentId = agentId,
            OrganizationId = organizationId,
            SessionId = sessionId,
            ActionName = actionName,
            DecisionPolicy = decisionPolicy,
            CapitalTransactedUsd = capitalUsd,
            CreatedAtUtc = occurredAtUtc
        };
        audit.MerkleProofHash = ComputeDigest(audit);
        return audit;
    }

    public static string ComputeDigest(AuditEvent e)
    {
        var canonical = string.Join('|',
            e.Id.ToString("N"), e.EventType, e.AgentId.ToString("N"), e.OrganizationId,
            e.SessionId?.ToString("N") ?? "-", e.ActionName, e.DecisionPolicy,
            e.CapitalTransactedUsd.ToString("0.0000", CultureInfo.InvariantCulture),
            e.CreatedAtUtc.ToString("O", CultureInfo.InvariantCulture));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    public static bool Verify(AuditEvent e) => string.Equals(e.MerkleProofHash, ComputeDigest(e), StringComparison.Ordinal);
}
