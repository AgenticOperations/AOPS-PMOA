using Microsoft.EntityFrameworkCore;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Application.Services;
using AgentOps.Infrastructure.Persistence;
using AgentOps.Infrastructure.Services;
using AgentOps.Worker.BackgroundServices;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddDbContext<AgentOpsDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")
        ?? "Server=(localdb)\\mssqllocaldb;Database=AgentOpsDb;Trusted_Connection=True;MultipleActiveResultSets=true"));
builder.Services.AddScoped<IAgentOpsDbContext>(sp => sp.GetRequiredService<AgentOpsDbContext>());
builder.Services.AddScoped<IExecutionReconciliationService, ExecutionReconciliationService>();
builder.Services.AddSingleton<IAzureQueueService, AzureQueueService>();
builder.Services.AddHostedService<ExecutionReconciliationWorker>();

builder.Build().Run();
