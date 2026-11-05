using FluentValidation;
using AgentOps.Application.DTOs;

namespace AgentOps.Application.Validators;

public class RegisterAgentValidator : AbstractValidator<RegisterAgentDto>
{
    public RegisterAgentValidator()
    {
        RuleFor(x => x.Name)
            .NotEmpty().WithMessage("Agent name is required.")
            .MaximumLength(100).WithMessage("Agent name cannot exceed 100 characters.");

        RuleFor(x => x.Role)
            .NotEmpty().WithMessage("Role definition is required.");

        RuleFor(x => x.PublicKey)
            .NotEmpty().WithMessage("Agent public key is required.")
            .MinimumLength(32).WithMessage("Invalid public key length.");

        RuleFor(x => x.DailyBudgetCapUsd)
            .GreaterThanOrEqualTo(0).WithMessage("Daily budget cap cannot be negative.");
    }
}
