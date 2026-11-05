using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgentOps.Infrastructure.Persistence.Migrations;

public partial class AgentOpsInitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "AgentIdentities",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                Role = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                PublicKey = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                OrganizationId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                Status = table.Column<int>(type: "int", nullable: false),
                DailyBudgetCapUsd = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                SpentTodayUsd = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                BudgetResetDateUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                ApiKeyHash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                IsDeleted = table.Column<bool>(type: "bit", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AgentIdentities", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "AuditEvents",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                EventType = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                AgentId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                SessionId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                OrganizationId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                ActionName = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                DecisionPolicy = table.Column<string>(type: "nvarchar(max)", nullable: false),
                CapitalTransactedUsd = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                MerkleProofHash = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                RawEvidenceBlobUrl = table.Column<string>(type: "nvarchar(max)", nullable: false),
                Signature = table.Column<string>(type: "nvarchar(max)", nullable: false),
                CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                IsDeleted = table.Column<bool>(type: "bit", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AuditEvents", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "GovernancePolicies",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Name = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: false),
                Description = table.Column<string>(type: "nvarchar(max)", nullable: false),
                OrganizationId = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                MaxAllowedRiskLevel = table.Column<int>(type: "int", nullable: false),
                AutoApprovalSpendThresholdUsd = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                RequiresMultiSigForExternalTransfers = table.Column<bool>(type: "bit", nullable: false),
                IsActive = table.Column<bool>(type: "bit", nullable: false),
                CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                IsDeleted = table.Column<bool>(type: "bit", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_GovernancePolicies", x => x.Id);
            });

        migrationBuilder.CreateTable(
            name: "ApprovalWorkflows",
            columns: table => new
            {
                Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                SessionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ActionId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                RequestedAmountUsd = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                State = table.Column<int>(type: "int", nullable: false),
                ApprovedByUserId = table.Column<string>(type: "nvarchar(max)", nullable: true),
                DecidedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                ExpiresAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                DecisionReason = table.Column<string>(type: "nvarchar(max)", nullable: true),
                CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                IsDeleted = table.Column<bool>(type: "bit", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ApprovalWorkflows", x => x.Id);
            });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "ApprovalWorkflows");
        migrationBuilder.DropTable(name: "GovernancePolicies");
        migrationBuilder.DropTable(name: "AuditEvents");
        migrationBuilder.DropTable(name: "AgentIdentities");
    }
}
