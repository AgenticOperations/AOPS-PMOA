using Microsoft.AspNetCore.Mvc;
using AgentOps.Application.DTOs;
using AgentOps.Application.Services;
using AgentOps.Domain.Enums;

namespace AgentOps.API.Controllers.Mvc;

public class PoliciesMvcController : Controller
{
    private readonly IPolicyEvaluationService _policyService;

    public PoliciesMvcController(IPolicyEvaluationService policyService)
    {
        _policyService = policyService;
    }

    public async Task<IActionResult> Index()
    {
        var policies = await _policyService.GetPoliciesAsync("arc-demo-org");
        return View(policies.Data);
    }

    public IActionResult Create()
    {
        return View(new CreatePolicyDto(string.Empty, string.Empty, "arc-demo-org", RiskLevel.Moderate, 250m, true));
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(CreatePolicyDto model)
    {
        if (!ModelState.IsValid) return View(model);

        var result = await _policyService.CreatePolicyAsync(model);
        if (!result.Succeeded)
        {
            ModelState.AddModelError(string.Empty, result.ErrorMessage ?? "Policy creation failed.");
            return View(model);
        }

        return RedirectToAction(nameof(Index));
    }
}
