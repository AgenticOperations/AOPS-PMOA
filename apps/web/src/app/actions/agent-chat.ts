'use server';

import {
  AgentChatApiError,
  postAgentChatTurn,
  type AgentChatTurn,
  type ChatHistoryMessage,
  type ChatPendingState,
} from '@/lib/server/agent-chat-client';

export type AgentChatActionState = {
  readonly ok?: boolean;
  readonly error?: string;
  readonly turn?: AgentChatTurn;
};

export async function agentChatTurnAction(
  orgId: string,
  orgSlug: string,
  input: {
    readonly message: string;
    readonly history: readonly ChatHistoryMessage[];
    readonly pending: ChatPendingState | null;
    readonly confirmId?: string | null;
  },
): Promise<AgentChatActionState> {
  try {
    const turn = await postAgentChatTurn(orgId, {
      message: input.message,
      orgSlug,
      history: input.history,
      pending: input.pending,
      confirmId: input.confirmId ?? null,
    });
    return { ok: true, turn };
  } catch (error) {
    if (error instanceof AgentChatApiError) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : 'Chat failed.' };
  }
}
