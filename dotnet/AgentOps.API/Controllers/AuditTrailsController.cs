using Microsoft.AspNetCore.Mvc;
using AgentOps.Infrastructure.Persistence.SqlQueries;

namespace AgentOps.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuditTrailsController : ControllerBase
{
    private readonly IAuditMetricsRawSqlService _rawSqlService;

    public AuditTrailsController(IAuditMetricsRawSqlService rawSqlService)
    {
        _rawSqlService = rawSqlService;
    }

    [HttpGet("telemetry/{orgId}")]
    public async Task<IActionResult> GetTelemetry(string orgId, CancellationToken cancellationToken)
    {
        var result = await _rawSqlService.GetTelemetryOverviewAsync(orgId, cancellationToken);
        return Ok(result);
    }

    [HttpGet("rankings/{orgId}")]
    public async Task<IActionResult> GetRankings(string orgId, CancellationToken cancellationToken)
    {
        var result = await _rawSqlService.GetAgentSpendRankingsAsync(orgId, cancellationToken);
        return Ok(result);
    }
}
