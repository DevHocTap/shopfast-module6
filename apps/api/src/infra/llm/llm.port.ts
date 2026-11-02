/**
 * Provider-neutral port for the AI assistant (F01). Services never import an LLM SDK:
 * production uses AnthropicLlmAdapter, tests use FakeLlm, and without a key DisabledLlm.
 */

export interface LlmToolSpec {
  name: string;
  description: string;
  /** JSON Schema of the input (object, every property required, no additional properties). */
  inputSchema: Record<string, unknown>;
}

export interface LlmToolOutcome {
  /** JSON text handed back to the model. */
  content: string;
  isError?: boolean;
}

export interface LlmToolCall {
  name: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
}

export interface LlmTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentRequest {
  system: string;
  /** Earlier turns plus the new user turn last. */
  turns: LlmTurn[];
  tools: LlmToolSpec[];
  runTool(name: string, input: Record<string, unknown>): Promise<LlmToolOutcome>;
  /** Hard cap on model ↔ tool round trips for one answer. */
  maxToolRounds: number;
}

export interface AgentResult {
  text: string;
  toolCalls: LlmToolCall[];
  /** `max_rounds`: the model still wanted tools when the cap was hit. */
  stopReason: 'end_turn' | 'max_rounds' | 'max_tokens' | 'refusal';
}

export interface ClassifyRequest {
  system: string;
  input: string;
  labels: readonly string[];
}

export interface ClassifyResult {
  label: string;
  /** 0..1, as estimated by the model. */
  confidence: number;
}

/** No key configured, quota exhausted, provider down: callers degrade instead of failing hard. */
export class LlmUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'LlmUnavailableError';
  }
}

export abstract class LlmPort {
  /** False when no provider is configured (the UI then shows the assistant as paused). */
  abstract readonly available: boolean;
  abstract runAgent(request: AgentRequest): Promise<AgentResult>;
  abstract classify(request: ClassifyRequest): Promise<ClassifyResult>;
}
