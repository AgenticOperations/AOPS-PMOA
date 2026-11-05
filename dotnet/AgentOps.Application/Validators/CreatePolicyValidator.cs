using FluentValidation;
using AgentOps.Application.DTOs;

namespace AgentOps.Application.Validators;

public class CreatePolicyValidator : AbstractValidator<CreatePolicyDto>
{
    public CreatePolicyValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Policy name is required.")
            .MaximumLength(100).WithMessage("Policy name cannot exceed 100 characters.");

        RuleFor(x => x.AutoApprovalSpendThresholdUsd)
            .GreaterThanOrEqualTo(0).WithMessage("Spend threshold cannot be negative.");
    }
}
