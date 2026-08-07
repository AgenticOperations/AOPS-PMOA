'use server';

import { resolveMcpPublicUrl } from '@/lib/server/mcp-public-url';
import {
  safeMcpVerificationMessage,
  verifyHostedMcp,
  type McpVerificationResult,
} from '@/lib/mcp-verification';

export type VerifyHostedMcpActionResult =
  | { readonly ok: true; readonly result: McpVerificationResult }
  | { readonly ok: false; readonly message: string };

/**
 * Browser verify must not fetch the MCP host directly: Chrome Local Network
 * Access blocks localhost:3005 → 127.0.0.1:8070 as a failed network request.
 * Run the same verifier on the Next server against the configured public URL.
 */
export async function verifyHostedMcpAction(input: {
  readonly credential: string;
}): Promise<VerifyHostedMcpActionResult> {
  try {
    const result = await verifyHostedMcp({
      credential: input.credential,
      endpoint: resolveMcpPublicUrl(),
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, message: safeMcpVerificationMessage(error) };
  }
}
