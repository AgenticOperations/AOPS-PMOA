import { AGENTOPS_KNOWLEDGE } from './knowledge.js';
import { geminiGenerate } from '../shared/gemini.js';
import type { ChatHistoryMessage, ChatIntent, ProposedAgent } from './types.js';

/** Strip common markdown so chat replies stay clean plain text. */
export function toPlainText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```(?:\w+)?\s*/m, '').replace(/\s*```$/m, '').trim(),
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function heuristicIntent(message: string, hasPending: boolean): ChatIntent {
  const m = message.trim().toLowerCase();
  if (hasPending && /^(yes|yep|yeah|ok|okay|confirm|do it|go ahead|create them|proceed|sure)\b/.test(m)) {
    return 'confirm';
  }
  if (/\b(fund|treasury|balance|deposit|insufficient|top.?up)\b/.test(m)) return 'fund';
  if (/\b(polic(y|ies)|controls|approval|budget.?cap|spend.?limit)\b/.test(m)) return 'policies';
  if (/\b(marketplace|listing|hire|recommend.*(agent|service)|what.*(sell|service))\b/.test(m)) {
    return 'marketplace';
  }
  if (/\b(create|spin.?up|provision|add)\b.*\bagents?\b/.test(m) || /\bagents?\b.*\b(create|spin.?up)\b/.test(m)) {
    return 'create_agents';
  }
  if (
    /\b(fleet|datafetcher|analyst|writer|seniorreviewer|orchestrator|research brief|second.?hop|a2a)\b/.test(m) ||
    /\bhire\b.*\b(data|analyst|writer|reviewer)\b/.test(m)
  ) {
    return 'fleet_run';
  }
  if (
    /\b(what (is|can)|how (do|does|can)|explain|tell me about|mcp|x402|agentops|arc.?nanopayment)\b/.test(m) ||
    m.endsWith('?')
  ) {
    return 'qa';
  }
  if (m.length < 24 && /^(hi|hello|hey|thanks|thank you)\b/.test(m)) return 'smalltalk';
  if (m.length >= 40) return 'fleet_run';
  return 'qa';
}

export async function classifyIntent(
  message: string,
  history: readonly ChatHistoryMessage[],
  hasPending: boolean,
): Promise<{ readonly intent: ChatIntent; readonly agents: readonly ProposedAgent[] | null }> {
  const fallback = heuristicIntent(message, hasPending);
  const gemini = await geminiGenerate(
    `Classify this AgentOps chat message. Return ONLY JSON:
{"intent":"qa|marketplace|create_agents|fund|policies|fleet_run|confirm|smalltalk","agents":[{"name":"...","description":"..."}]|null}

Rules:
- confirm if user agrees to a pending create/run.
- create_agents if they want N new agents (fill agents array with names).
- fleet_run if they want a multi-agent research/payment goal.
- marketplace if asking what to hire/buy from catalog.
- fund for balance/treasury.
- policies for spend rules/approvals.
- qa for product how-to / MCP / AgentOps questions.
- agents null unless create_agents or fleet_run proposing a custom roster.

Pending exists: ${hasPending}
Recent history: ${JSON.stringify(history.slice(-4))}
Message: ${message}`,
    { temperature: 0.1, maxOutputTokens: 400 },
  );
  if (gemini === null) return { intent: fallback, agents: null };
  const parsed = extractJsonObject(gemini);
  if (parsed === null) return { intent: fallback, agents: null };
  const intentRaw = typeof parsed.intent === 'string' ? parsed.intent : fallback;
  const allowed: ChatIntent[] = [
    'qa',
    'marketplace',
    'create_agents',
    'fund',
    'policies',
    'fleet_run',
    'confirm',
    'smalltalk',
  ];
  const intent = (allowed.includes(intentRaw as ChatIntent) ? intentRaw : fallback) as ChatIntent;
  let agents: ProposedAgent[] | null = null;
  if (Array.isArray(parsed.agents)) {
    agents = parsed.agents.flatMap((item) => {
      if (item === null || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (name.length === 0) return [];
      const description =
        typeof row.description === 'string' && row.description.trim().length > 0
          ? row.description.trim()
          : `AgentOps agent (${name})`;
      return [{ name, description }];
    });
    if (agents.length === 0) agents = null;
  }
  return { intent, agents };
}

export async function answerQa(message: string, history: readonly ChatHistoryMessage[]): Promise<string> {
  const fallback =
    'AgentOps is the control plane for agent payments and ops: create agents, empower wallets, fund treasury, set policies, buy via MCP or marketplace, and run fleets under org rules. Ask me to create agents, recommend marketplace listings, check funding, or run a multi-agent goal.';
  const gemini = await geminiGenerate(
    `You are the AgentOps co-pilot in Chat with agent. Answer briefly (2-5 short sentences, or a short plain bullet list using •). Use this knowledge. Offer one concrete next step when useful. Do not invent tx hashes or fake balances.

CRITICAL: Reply in plain clean text only. No markdown. No **, *, __, #, backticks, or [links](url).

Knowledge:
${AGENTOPS_KNOWLEDGE}

History:
${JSON.stringify(history.slice(-6))}

User:
${message}`,
    { temperature: 0.45, maxOutputTokens: 500 },
  );
  return toPlainText(gemini ?? fallback);
}

export async function narrateShort(prompt: string, fallback: string): Promise<string> {
  const gemini = await geminiGenerate(
    `You are the AgentOps co-pilot. ${prompt}
Keep it under 80 words.
CRITICAL: Plain clean text only. No markdown. No **, *, __, #, backticks, or [links](url).`,
    { temperature: 0.4, maxOutputTokens: 280 },
  );
  return toPlainText(gemini ?? fallback);
}

export function parseAgentCount(message: string): number | null {
  const match = /\b(\d{1,2})\s+agents?\b/i.exec(message) ?? /\bcreate\s+(\d{1,2})\b/i.exec(message);
  if (match?.[1] === undefined) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1 || n > 20) return null;
  return n;
}

export function inventNAgents(n: number, goalHint?: string): ProposedAgent[] {
  const base = ['Coordinator', 'Researcher', 'Analyst', 'Writer', 'Reviewer', 'Scout', 'Editor', 'Validator'];
  const out: ProposedAgent[] = [];
  for (let i = 0; i < n; i += 1) {
    const name = base[i] ?? `Agent${i + 1}`;
    out.push({
      name,
      description: goalHint
        ? `${name} for: ${goalHint.slice(0, 80)}`
        : `Custom AgentOps agent (${name})`,
    });
  }
  return out;
}
