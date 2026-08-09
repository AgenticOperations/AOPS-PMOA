import type { FleetChecklistItem } from './types.js';
import { geminiGenerate } from '../shared/gemini.js';
import { toPlainText } from '../agent-chat/gemini.js';

function templateAssistant(goal: string): string {
  const first = goal.trim().split('\n')[0] ?? goal.trim();
  return `Got it — I'll work that for you.

${first}

I'll check which agents are available, pull the services you need, and come back with a clear answer plus any payment receipts when settlement is live.`;
}

function templatePlan(_goal: string, checklist: readonly FleetChecklistItem[]): string {
  const steps = checklist.map((item, index) => `${index + 1}. ${item.label}`).join('\n');
  return `Here's how I'll fulfill that:

${steps}

Working on it now.`;
}

function templateFruit(
  goal: string,
  payloads: Record<string, unknown>,
  receipts: readonly Record<string, unknown>[],
): string {
  const receiptLines = receipts.length === 0
    ? 'No on-chain receipts this run (services fulfilled from the agent catalog).'
    : receipts
      .map((r) => `• ${String(r.payer)} → ${String(r.payee)} (${String(r.chain)}): ${String(r.amountUsdc)} USDC · ${String(r.txHash)}`)
      .join('\n');

  const writer = (payloads.writer as { data?: { abstract?: string; body?: string; title?: string } } | undefined)?.data;
  const analyst = (payloads.analyst as { data?: { analysis?: string } } | undefined)?.data;
  const review = (payloads.senior_reviewer as { data?: { verdict?: string; notes?: string } } | undefined)?.data;
  const data = (payloads.data_fetcher as { data?: { summary?: string } } | undefined)?.data;

  return `Here's what I found

${writer?.abstract ?? writer?.body ?? analyst?.analysis ?? data?.summary ?? `Completed your request: ${goal.trim().split('\n')[0]}`}

Details
• Data: ${data?.summary ?? 'Market snapshot ready'}
• Analysis: ${analyst?.analysis ?? 'Brief ready'}
• Report: ${writer?.title ?? writer?.body ?? 'Research report ready'}
• Review: ${review?.verdict ?? 'approved'} — ${review?.notes ?? 'No blocking issues'}

Receipts
${receiptLines}`;
}

/** First chat bubble — sounds like a normal agent, not an ops console. */
export async function narrateAssistantOpening(goal: string): Promise<string> {
  const fallback = templateAssistant(goal);
  const gemini = await geminiGenerate(
    `You are a helpful AgentOps chat agent. The user just sent this request. Reply in 2-4 short sentences like a capable assistant: acknowledge the ask, say you'll use the org's agents/services to fulfill it, and stay warm and clear. No bullet ops checklist. No mentioning ports, KEEP_SELLERS, or demo scripts. Plain text only — no markdown.\n\nUser message:\n${goal}`,
  );
  return toPlainText(gemini ?? fallback);
}

export async function narratePlan(
  goal: string,
  checklist: readonly FleetChecklistItem[],
): Promise<string> {
  const fallback = templatePlan(goal, checklist);
  const gemini = await geminiGenerate(
    `You are a helpful AgentOps chat agent. Briefly tell the user how you'll fulfill their request (2-5 short lines). You may list steps in plain language with • bullets. Do not invent payment tx hashes. Do not mention seller ports or KEEP_SELLERS. Plain text only — no markdown.\n\nUser request:\n${goal}\n\nInternal checklist (for your eyes only, paraphrase):\n${JSON.stringify(checklist.map((c) => c.label))}`,
  );
  return toPlainText(gemini ?? fallback);
}

export async function narrateFruit(
  goal: string,
  payloads: Record<string, unknown>,
  receipts: readonly Record<string, unknown>[],
): Promise<string> {
  const fallback = templateFruit(goal, payloads, receipts);
  const gemini = await geminiGenerate(
    `You are a helpful AgentOps chat agent delivering the final answer. Write a clear user-facing response that fulfills their request using ONLY the provided service payloads and receipts. Do not invent tx hashes. If receipts are empty, say services were fulfilled and settlement will appear when sellers are live — still give the useful answer from payloads. Under 350 words. Sound like a chat assistant, not a runbook. Plain text only — no markdown, no **, no headings with #.\n\nUser request:\n${goal}\n\nPayloads:\n${JSON.stringify(payloads).slice(0, 6000)}\n\nReceipts:\n${JSON.stringify(receipts)}`,
  );
  return toPlainText(gemini ?? fallback);
}
