export type ChatLink = {
  readonly label: string;
  readonly href: string;
};

export type ChatConfirm = {
  readonly id: string;
  readonly kind: 'create_agents' | 'run_fleet' | 'continue_after_create';
  readonly label: string;
};

/** Marketplace hire suggestions shown as cards in chat (not dumped into reply text). */
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
  readonly label?: string | undefined;
  readonly status: 'pending' | 'active' | 'done';
};

export type ChatGraph = {
  readonly nodes: readonly ChatGraphNode[];
  readonly edges: readonly ChatGraphEdge[];
};

export type ProposedAgent = {
  readonly name: string;
  readonly description: string;
  readonly role?: string | undefined;
};

export type ChatPendingState = {
  readonly kind: 'create_agents' | 'run_fleet' | 'after_create';
  readonly agents: readonly ProposedAgent[];
  readonly goal?: string | undefined;
  readonly createdNames?: readonly string[] | undefined;
};

export type ChatHistoryMessage = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
};

export type AgentChatTurnRequest = {
  readonly message: string;
  readonly orgSlug: string;
  readonly history?: readonly ChatHistoryMessage[] | undefined;
  readonly pending?: ChatPendingState | null | undefined;
  readonly confirmId?: string | null | undefined;
};

export type AgentChatTurnResponse = {
  readonly reply: string;
  readonly links: readonly ChatLink[];
  readonly confirms: readonly ChatConfirm[];
  readonly listings: readonly ChatListingSuggestion[];
  readonly graph: ChatGraph | null;
  readonly pending: ChatPendingState | null;
  readonly runId: string | null;
};

export type ChatIntent =
  | 'qa'
  | 'marketplace'
  | 'create_agents'
  | 'fund'
  | 'policies'
  | 'fleet_run'
  | 'confirm'
  | 'smalltalk';
