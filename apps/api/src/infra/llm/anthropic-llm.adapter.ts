import Anthropic from '@anthropic-ai/sdk';
import {
  AgentRequest,
  AgentResult,
  ClassifyRequest,
  ClassifyResult,
  LlmPort,
  LlmToolCall,
  LlmUnavailableError,
} from './llm.port';

import type * as Beta from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** Server-side fallback: on a safety refusal the API retries on a suitable model by itself. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** What the adapter needs from the SDK client (lets unit tests pass a stub). */
export interface MessagesClient {
  beta: {
    messages: { create(params: Beta.MessageCreateParamsNonStreaming): Promise<Beta.BetaMessage> };
  };
}

export interface AnthropicLlmOptions {
  model: string;
  timeoutMs: number;
}

/**
 * Claude through the official SDK. The tool loop is written out (not the beta tool runner) so
 * every call and result is captured for the audit trail and the output guard.
 */
export class AnthropicLlmAdapter extends LlmPort {
  readonly available = true;

  constructor(
    private readonly client: MessagesClient,
    private readonly options: AnthropicLlmOptions,
  ) {
    super();
  }

  static create(apiKey: string, options: AnthropicLlmOptions): AnthropicLlmAdapter {
    // One retry: a support agent waits on this answer, the job queue handles longer retries.
    const client = new Anthropic({ apiKey, timeout: options.timeoutMs, maxRetries: 1 });
    return new AnthropicLlmAdapter(client, options);
  }

  async runAgent(request: AgentRequest): Promise<AgentResult> {
    const tools: Beta.BetaTool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Beta.BetaTool.InputSchema,
      strict: true,
    }));
    const messages: Beta.BetaMessageParam[] = request.turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
    const calls: LlmToolCall[] = [];

    for (let round = 0; ; round++) {
      const response = await this.send({
        model: this.options.model,
        max_tokens: 16_000,
        system: request.system,
        // Thinking is always on for this model family; effort keeps answers quick for live chat.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools,
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        return {
          text: textOf(response),
          toolCalls: calls,
          stopReason:
            response.stop_reason === 'refusal'
              ? 'refusal'
              : response.stop_reason === 'max_tokens'
                ? 'max_tokens'
                : 'end_turn',
        };
      }
      if (round >= request.maxToolRounds) {
        return { text: textOf(response), toolCalls: calls, stopReason: 'max_rounds' };
      }

      // The full assistant content goes back unchanged (thinking blocks included).
      messages.push({ role: 'assistant', content: response.content });
      const results: Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const input = (block.input ?? {}) as Record<string, unknown>;
        const outcome = await request
          .runTool(block.name, input)
          .catch(() => ({ content: '{"error":"TOOL_FAILED"}', isError: true }));
        calls.push({
          name: block.name,
          input,
          output: outcome.content,
          isError: !!outcome.isError,
        });
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: outcome.content,
          is_error: outcome.isError ?? false,
        });
      }
      // All results of one turn travel in a single user message.
      messages.push({ role: 'user', content: results });
    }
  }

  async classify(request: ClassifyRequest): Promise<ClassifyResult> {
    const response = await this.send({
      model: this.options.model,
      max_tokens: 4_096,
      system: request.system,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: [...request.labels] },
              confidence: { type: 'number' },
            },
            required: ['category', 'confidence'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content: request.input }],
    });
    if (response.stop_reason === 'refusal') return { label: 'UNCLASSIFIED', confidence: 0 };
    const parsed = JSON.parse(textOf(response)) as { category: string; confidence: number };
    return {
      label: parsed.category,
      confidence: Math.min(Math.max(Number(parsed.confidence) || 0, 0), 1),
    };
  }

  private async send(
    params: Omit<Beta.MessageCreateParamsNonStreaming, 'betas' | 'fallbacks'>,
  ): Promise<Beta.BetaMessage> {
    try {
      return await this.client.beta.messages.create({
        ...params,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      });
    } catch (error) {
      // Provider-side problems (auth, quota, overload, network) degrade the feature;
      // a 400 means our request is wrong and must surface as a bug.
      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError ||
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError ||
        error instanceof Anthropic.APIConnectionError
      ) {
        throw new LlmUnavailableError(error.message);
      }
      throw error;
    }
  }
}

function textOf(message: Beta.BetaMessage): string {
  return message.content
    .filter((block): block is Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}
