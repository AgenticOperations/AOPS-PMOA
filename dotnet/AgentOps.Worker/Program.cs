using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using AgentOps.Application.Common.Interfaces;
using AgentOps.Infrastructure.Services;
using AgentOps.Worker.BackgroundServices;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddSingleton<IAzureQueueService, AzureQueueService>();
builder.Services.AddHostedService<ExecutionReconciliationWorker>();

var host = builder.Build();
host.Run();
