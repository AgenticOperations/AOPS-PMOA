import 'server-only';
import { cookies } from 'next/headers';
import { readWebEnv } from '../env';

export type ChatLink = {
  readonly label: string;
  readonly href: string;
};

export type ChatConfirm = {
  readonly id: string;
  readonly kind: 'create_agents' | 'run_fleet' | 'continue_after_create';
  readonly label: string;
};

export type ChatListingSuggestion = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly priceHint: string;
  readonly chain: string;
  readonly summary: string;
  readonly href: string;
};

export type ChatGraphNode = {
  readonly id: string;
  readonly label: string;
  readonly status: 'pending' | 'creating' | 'ready' | 'running' | 'done' | 'failed';
};

export type ChatGraphEdge = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'wire' | 'payment';
  readonly label?: string;
  readonly status: 'pending' | 'active' | 'done';
};

export type ChatGraph = {
  readonly nodes: readonly ChatGraphNode[];
  readonly edges: readonly ChatGraphEdge[];
};

export type ProposedAgent = {
  readonly name: string;
  readonly description: string;
  readonly role?: string;
};

export type ChatPendingState = {
  readonly kind: 'create_agents' | 'run_fleet' | 'after_create';
  readonly agents: readonly ProposedAgent[];
  readonly goal?: string;
  readonly createdNames?: readonly string[];
};

export type ChatHistoryMessage = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
};

export type AgentChatTurn = {
  readonly reply: string;
  readonly links: readonly ChatLink[];
  readonly confirms: readonly ChatConfirm[];
  readonly listings?: readonly ChatListingSuggestion[];
  readonly graph: ChatGraph | null;
  readonly pending: ChatPendingState | null;
  readonly runId: string | null;
};

export class AgentChatApiError extends Error {
  readonly code: string | null;
  readonly status: number;

  constructor(status: number, body: { readonly error?: string; readonly message?: string }) {
    super(body.message ?? body.error ?? `Agent chat failed (${status})`);
    this.name = 'AgentChatApiError';
    this.code = body.error ?? null;
    this.status = status;
  }
}

function apiBaseUrl(): string {
  return readWebEnv().AGENTOPS_API_BASE_URL.replace(/\/$/, '');
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const env = readWebEnv();
  const cookieStore = await cookies();
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

export async function postAgentChatTurn(
  orgId: string,
  input: {
    readonly message: string;
    readonly orgSlug: string;
    readonly history?: readonly ChatHistoryMessage[];
    readonly pending?: ChatPendingState | null;
    readonly confirmId?: string | null;
  },
): Promise<AgentChatTurn> {
  const response = await fetch(`${apiBaseUrl()}/v1/orgs/${orgId}/agent-chat/turn`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      ...(await sessionHeaders()),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: input.message,
      orgSlug: input.orgSlug,
      history: input.history ?? [],
      pending: input.pending ?? null,
      confirmId: input.confirmId ?? null,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    readonly turn?: AgentChatTurn;
    readonly error?: string;
    readonly message?: string;
  };
  if (!response.ok || body.turn === undefined) {
    throw new AgentChatApiError(response.status, body);
  }
  return body.turn;
}
