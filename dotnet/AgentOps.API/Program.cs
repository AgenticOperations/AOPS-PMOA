using FluentValidation;
using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Services;
using AgentOps.Application.Validators;
using AgentOps.Infrastructure.Persistence;
using AgentOps.Infrastructure.Persistence.SqlQueries;
using AgentOps.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

// 1. Database Configuration (EF Core + SQL Server)
builder.Services.AddDbContext<AgentOpsDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
        ?? "Server=(localdb)\\mssqllocaldb;Database=AgentOpsDb;Trusted_Connection=True;MultipleActiveResultSets=true";
    options.UseSqlServer(connectionString);
});

builder.Services.AddScoped<IAgentOpsDbContext>(sp => sp.GetRequiredService<AgentOpsDbContext>());

// 2. Application Services
builder.Services.AddScoped<IAgentRegistrationService, AgentRegistrationService>();
builder.Services.AddScoped<IPolicyEvaluationService, PolicyEvaluationService>();
builder.Services.AddScoped<IExecutionLifecycleService, ExecutionLifecycleService>();
builder.Services.AddScoped<IApprovalWorkflowService, ApprovalWorkflowService>();
builder.Services.AddScoped<IExecutionReconciliationService, ExecutionReconciliationService>();
builder.Services.AddScoped<IAuditMetricsRawSqlService, AuditMetricsRawSqlService>();

// 3. Azure Cloud & LLM Services
builder.Services.AddSingleton<IAzureQueueService, AzureQueueService>();
builder.Services.AddHttpClient<ILlmAuditReasoningService, AzureOpenAiAuditService>();

// 4. FluentValidation
builder.Services.AddValidatorsFromAssemblyContaining<RegisterAgentValidator>();

// 5. ASP.NET MVC with Views & REST API Controllers
builder.Services.AddControllersWithViews()
    .AddRazorRuntimeCompilation();

// 6. Swagger OpenAPI
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "AgentOps Governance API", Version = "v1", Description = "Enterprise .NET Core / ASP.NET MVC control plane for autonomous agent governance." });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "AgentOps API v1"));
}

app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=OperationsConsole}/{action=Index}/{id?}");

app.MapControllers();

app.Run();
