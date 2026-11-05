using Microsoft.AspNetCore.Mvc;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;

namespace AgentOps.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GovernancePoliciesController : ControllerBase
{
    private readonly IPolicyEvaluationService _policyService;

    public GovernancePoliciesController(IPolicyEvaluationService policyService)
    {
        _policyService = policyService;
    }

    [HttpPost]
    public async Task<IActionResult> CreatePolicy([FromBody] CreatePolicyDto dto, CancellationToken cancellationToken)
    {
        var result = await _policyService.CreatePolicyAsync(dto, cancellationToken);
        return Ok(result.Data);
    }

    [HttpGet("org/{orgId}")]
    public async Task<IActionResult> GetPolicies(string orgId, CancellationToken cancellationToken)
    {
        var result = await _policyService.GetPoliciesAsync(orgId, cancellationToken);
        return Ok(result.Data);
    }

    [HttpPost("evaluate")]
    public async Task<IActionResult> EvaluateExecution([FromBody] EvaluateExecutionRequestDto dto, CancellationToken cancellationToken)
    {
        var result = await _policyService.EvaluateExecutionAsync(dto, cancellationToken);
        return Ok(result);
    }
}
