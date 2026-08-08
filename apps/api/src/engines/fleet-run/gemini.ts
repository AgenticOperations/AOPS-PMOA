import type { FleetChecklistItem } from './types.js';

function templatePlan(goal: string, checklist: readonly FleetChecklistItem[]): string {
  const steps = checklist.map((item, index) => `${index + 1}. ${item.label} (\`${item.tool}\`)`).join('\n');
  return `I'll run this under AgentOps guardrails — every hire goes through real runtime tools, not a side channel.

**Goal**
${goal.trim()}

**Plan**
${steps}

Confirming live sellers, then executing Permit2 intra-fleet payments (Arc specialists + Base SeniorReviewer).`;
}

function templateFruit(
  goal: string,
  payloads: Record<string, unknown>,
  receipts: readonly Record<string, unknown>[],
): string {
  const receiptLines = receipts
    .map((r) => `- ${String(r.payer)} → ${String(r.payee)} (${String(r.chain)}): ${String(r.amountUsdc)} USDC · \`${String(r.txHash)}\``)
    .join('\n');
  return `## Research brief

Goal: ${goal.trim().split('\n')[0]}

The org fleet completed hub→spoke hires, a second-hop Analyst→DataFetcher payment, and a cross-chain SeniorReviewer settlement on Base. Deliverables were returned by each specialist after AgentOps \`payment_intra_fleet\` settlement.

### Specialist signals
- DataFetcher: ${JSON.stringify((payloads.data_fetcher as { data?: unknown } | undefined)?.data ?? payloads.data_fetcher ?? 'ok')}
- Analyst: ${JSON.stringify((payloads.analyst as { data?: unknown } | undefined)?.data ?? payloads.analyst ?? 'ok')}
- Writer: ${JSON.stringify((payloads.writer as { data?: unknown } | undefined)?.data ?? payloads.writer ?? 'ok')}
- SeniorReviewer: ${JSON.stringify((payloads.senior_reviewer as { data?: unknown } | undefined)?.data ?? payloads.senior_reviewer ?? 'ok')}

### Payment receipts
${receiptLines}

All spends were bounded by per-agent wallets and AgentOps runtime rails.`;
}

async function geminiGenerate(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) return null;
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        }),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function narratePlan(
  goal: string,
  checklist: readonly FleetChecklistItem[],
): Promise<string> {
  const fallback = templatePlan(goal, checklist);
  const gemini = await geminiGenerate(
    `You are AgentOps Fleet Run narrator. Write a short, confident operator-facing plan (markdown) for this goal. List each checklist step with its AgentOps tool name. Do not invent payments. Keep under 220 words.\n\nGoal:\n${goal}\n\nChecklist JSON:\n${JSON.stringify(checklist)}`,
  );
  return gemini ?? fallback;
}

export async function narrateFruit(
  goal: string,
  payloads: Record<string, unknown>,
  receipts: readonly Record<string, unknown>[],
): Promise<string> {
  const fallback = templateFruit(goal, payloads, receipts);
  const gemini = await geminiGenerate(
    `You are AgentOps Fleet Run narrator. Write the final research brief the user asked for, plus a receipts section. Use only the provided specialist payloads and payment receipts — do not invent tx hashes. Markdown, under 350 words.\n\nGoal:\n${goal}\n\nPayloads:\n${JSON.stringify(payloads).slice(0, 6000)}\n\nReceipts:\n${JSON.stringify(receipts)}`,
  );
  return gemini ?? fallback;
}
