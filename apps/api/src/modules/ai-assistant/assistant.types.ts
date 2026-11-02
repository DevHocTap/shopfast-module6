export enum AgentActionStatus {
  PROPOSED = 'PROPOSED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
}

export type AgentActionType = 'CANCEL_ORDER';

export interface AgentActionView {
  id: string;
  type: AgentActionType;
  status: AgentActionStatus;
  reason: string;
  ticket: { id: string; code: string };
  order: { id: string; code: string };
  reviewedBy: { id: string; fullName: string } | null;
  reviewedAt: Date | null;
  /** Outcome text once executed or failed. */
  result: string | null;
  createdAt: Date;
}

export interface ToolCallView {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolCallView[];
  guarded: boolean;
  createdAt: Date;
}

export interface ChatResult {
  reply: string;
  guarded: boolean;
  toolCalls: ToolCallView[];
  /** Proposals still waiting for a decision on this ticket. */
  actions: AgentActionView[];
}

export interface Conversation {
  /** False when no LLM provider is configured. */
  available: boolean;
  turns: AssistantTurn[];
  actions: AgentActionView[];
}
