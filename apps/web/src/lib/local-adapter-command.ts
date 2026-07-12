export function buildLocalAdapterCommand(credential: string): string {
  return `AGENTOPS_API_BASE_URL=http://localhost:8080 AGENTOPS_MCP_CREDENTIAL=${credential} npm run dev:mcp`;
}
