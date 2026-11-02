import {
  AgentRequest,
  AgentResult,
  ClassifyRequest,
  ClassifyResult,
  LlmPort,
  LlmToolCall,
} from './llm.port';

/** One scripted model step: call these tools, or answer with this text. */
export type FakeStep =
  { tools: { name: string; input: Record<string, unknown> }[] } | { text: string };

/**
 * Deterministic stand-in for tests (no network, no cost). `script` decides each step from the
 * request and the tool calls made so far, which is how tests express "look up, then answer".
 */
export class FakeLlm extends LlmPort {
  readonly available = true;
  readonly agentRequests: AgentRequest[] = [];

  constructor(
    private readonly script: (request: AgentRequest, calls: LlmToolCall[]) => FakeStep = () => ({
      text: 'OK',
    }),
    private readonly classifier: (request: ClassifyRequest) => ClassifyResult = (request) => ({
      label: request.labels[0],
      confidence: 0.9,
    }),
  ) {
    super();
  }

  async runAgent(request: AgentRequest): Promise<AgentResult> {
    this.agentRequests.push(request);
    const calls: LlmToolCall[] = [];
    for (let round = 0; round <= request.maxToolRounds; round++) {
      const step = this.script(request, calls);
      if ('text' in step) return { text: step.text, toolCalls: calls, stopReason: 'end_turn' };
      if (round === request.maxToolRounds) break;
      for (const tool of step.tools) {
        const outcome = await request.runTool(tool.name, tool.input);
        calls.push({ ...tool, output: outcome.content, isError: !!outcome.isError });
      }
    }
    return { text: '', toolCalls: calls, stopReason: 'max_rounds' };
  }

  classify(request: ClassifyRequest): Promise<ClassifyResult> {
    return Promise.resolve(this.classifier(request));
  }
}
