using Microsoft.AspNetCore.Mvc;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;

namespace AgentOps.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ExecutionTrackingController : ControllerBase
{
    private readonly IExecutionLifecycleService _executionService;

    public ExecutionTrackingController(IExecutionLifecycleService executionService)
    {
        _executionService = executionService;
    }

    [HttpPost("request")]
    public async Task<IActionResult> RequestExecution([FromBody] RequestExecutionDto dto, CancellationToken cancellationToken)
    {
        var result = await _executionService.RequestExecutionAsync(dto, cancellationToken);
        return Ok(result.Data);
    }

    [HttpGet("{sessionId:guid}")]
    public async Task<IActionResult> GetStatus(Guid sessionId, CancellationToken cancellationToken)
    {
        var result = await _executionService.GetSessionStatusAsync(sessionId, cancellationToken);
        if (!result.Succeeded) return NotFound(result.ErrorMessage);
        return Ok(result.Data);
    }
}
