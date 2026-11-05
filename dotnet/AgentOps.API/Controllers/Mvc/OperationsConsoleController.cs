using Microsoft.AspNetCore.Mvc;
using AgentOps.Application.Services;
using AgentOps.Infrastructure.Persistence.SqlQueries;

namespace AgentOps.API.Controllers.Mvc;

public class OperationsConsoleController : Controller
{
    private readonly IAgentRegistrationService _agentService;
    private readonly IAuditMetricsRawSqlService _auditSql;

    public OperationsConsoleController(
        IAgentRegistrationService agentService,
        IAuditMetricsRawSqlService auditSql)
    {
        _agentService = agentService;
        _auditSql = auditSql;
    }

    public async Task<IActionResult> Index()
    {
        var defaultOrg = "arc-demo-org";
        var agents = await _agentService.GetAgentsByOrgAsync(defaultOrg);
        var telemetry = await _auditSql.GetTelemetryOverviewAsync(defaultOrg);

        ViewBag.Telemetry = telemetry;
        return View(agents.Data);
    }
}
