using System.Data;
using Dapper;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using AgentOps.Application.DTOs;

namespace AgentOps.Infrastructure.Persistence.SqlQueries;

public interface IAuditMetricsRawSqlService
{
    Task<AuditTelemetryOverviewDto> GetTelemetryOverviewAsync(string organizationId, CancellationToken cancellationToken = default);
    Task<List<dynamic>> GetAgentSpendRankingsAsync(string organizationId, CancellationToken cancellationToken = default);
}

public class AuditMetricsRawSqlService : IAuditMetricsRawSqlService
{
    private readonly string _connectionString;

    public AuditMetricsRawSqlService(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? "Server=(localdb)\\mssqllocaldb;Database=AgentOpsDb;Trusted_Connection=True;MultipleActiveResultSets=true";
    }

    private IDbConnection CreateConnection() => new SqlConnection(_connectionString);

    public async Task<AuditTelemetryOverviewDto> GetTelemetryOverviewAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        const string sql = @"
            SELECT 
                COUNT(ae.Id) AS TotalEventsLogged,
                COALESCE(SUM(ae.CapitalTransactedUsd), 0) AS TotalCapitalRoutedUsd,
                (SELECT COUNT(1) FROM AgentIdentities WHERE OrganizationId = @OrgId AND Status = 1) AS ActiveAgentsCount,
                (SELECT COUNT(1) FROM ExecutionActions ea INNER JOIN ExecutionSessions es ON ea.SessionId = es.Id INNER JOIN AgentIdentities ai ON es.AgentId = ai.Id WHERE ai.OrganizationId = @OrgId AND ea.Status = 6) AS BlockedViolationsCount
            FROM AuditEvents ae
            WHERE ae.OrganizationId = @OrgId;";

        using var connection = CreateConnection();
        var row = await connection.QueryFirstOrDefaultAsync<dynamic>(new CommandDefinition(sql, new { OrgId = organizationId }, cancellationToken: cancellationToken));

        return new AuditTelemetryOverviewDto(
            (int)(row?.TotalEventsLogged ?? 0),
            (decimal)(row?.TotalCapitalRoutedUsd ?? 0m),
            (int)(row?.ActiveAgentsCount ?? 0),
            (int)(row?.BlockedViolationsCount ?? 0)
        );
    }

    public async Task<List<dynamic>> GetAgentSpendRankingsAsync(string organizationId, CancellationToken cancellationToken = default)
    {
        const string sql = @"
            WITH AgentSpendCTE AS (
                SELECT 
                    a.Id AS AgentId,
                    a.Name AS AgentName,
                    a.Role,
                    COALESCE(SUM(es.TotalExecutedSpendUsd), 0) AS TotalHistoricalSpendUsd,
                    COUNT(es.Id) AS TotalSessionsExecuted
                FROM AgentIdentities a
                LEFT JOIN ExecutionSessions es ON es.AgentId = a.Id
                WHERE a.OrganizationId = @OrgId AND a.IsDeleted = 0
                GROUP BY a.Id, a.Name, a.Role
            )
            SELECT 
                AgentId,
                AgentName,
                Role,
                TotalHistoricalSpendUsd,
                TotalSessionsExecuted,
                DENSE_RANK() OVER (ORDER BY TotalHistoricalSpendUsd DESC, TotalSessionsExecuted DESC) AS [SpendRank]
            FROM AgentSpendCTE
            ORDER BY [SpendRank] ASC;";

        using var connection = CreateConnection();
        var result = await connection.QueryAsync<dynamic>(new CommandDefinition(sql, new { OrgId = organizationId }, cancellationToken: cancellationToken));
        return result.ToList();
    }
}
