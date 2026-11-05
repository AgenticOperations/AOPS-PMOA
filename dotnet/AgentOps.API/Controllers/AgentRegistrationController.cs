using Microsoft.AspNetCore.Mvc;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;

namespace AgentOps.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AgentRegistrationController : ControllerBase
{
    private readonly IAgentRegistrationService _registrationService;

    public AgentRegistrationController(IAgentRegistrationService registrationService)
    {
        _registrationService = registrationService;
    }

    [HttpPost]
    public async Task<IActionResult> RegisterAgent([FromBody] RegisterAgentDto dto, CancellationToken cancellationToken)
    {
        var result = await _registrationService.RegisterAgentAsync(dto, cancellationToken);
        if (!result.Succeeded) return BadRequest(result.ErrorMessage);
        return CreatedAtAction(nameof(GetAgentById), new { id = result.Data!.Id }, result.Data);
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetAgentById(Guid id, CancellationToken cancellationToken)
    {
        var result = await _registrationService.GetAgentByIdAsync(id, cancellationToken);
        if (!result.Succeeded) return NotFound(result.ErrorMessage);
        return Ok(result.Data);
    }

    [HttpGet("org/{orgId}")]
    public async Task<IActionResult> GetAgentsByOrg(string orgId, CancellationToken cancellationToken)
    {
        var result = await _registrationService.GetAgentsByOrgAsync(orgId, cancellationToken);
        return Ok(result.Data);
    }

    [HttpPost("{id:guid}/tools")]
    public async Task<IActionResult> GrantTool(Guid id, [FromBody] GrantToolPermissionDto dto, CancellationToken cancellationToken)
    {
        var result = await _registrationService.GrantToolPermissionAsync(id, dto, cancellationToken);
        if (!result.Succeeded) return BadRequest(result.ErrorMessage);
        return Ok(new { success = true });
    }
}
