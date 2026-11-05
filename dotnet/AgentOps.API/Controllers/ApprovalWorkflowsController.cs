using Microsoft.AspNetCore.Mvc;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;

namespace AgentOps.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ApprovalWorkflowsController : ControllerBase
{
    private readonly IApprovalWorkflowService _approvalService;

    public ApprovalWorkflowsController(IApprovalWorkflowService approvalService)
    {
        _approvalService = approvalService;
    }

    [HttpGet("pending")]
    public async Task<IActionResult> GetPending(CancellationToken cancellationToken)
    {
        var result = await _approvalService.GetPendingApprovalsAsync(cancellationToken);
        return Ok(result.Data);
    }

    [HttpPost("{workflowId:guid}/decision")]
    public async Task<IActionResult> SubmitDecision(Guid workflowId, [FromBody] SubmitApprovalDecisionDto dto, CancellationToken cancellationToken)
    {
        var result = await _approvalService.SubmitDecisionAsync(workflowId, dto, cancellationToken);
        if (!result.Succeeded) return BadRequest(result.ErrorMessage);
        return Ok(new { success = true });
    }
}
