namespace AgentOps.Application.DTOs;

public record AuditEventDto(Guid Id, string EventType, Guid AgentId, string ActionName, string DecisionPolicy, decimal CapitalTransactedUsd, string MerkleProofHash, DateTime TimestampUtc);
public record AuditTelemetryOverviewDto(int TotalEventsLogged, decimal TotalCapitalRoutedUsd, int ActiveAgentsCount, int BlockedViolationsCount);
