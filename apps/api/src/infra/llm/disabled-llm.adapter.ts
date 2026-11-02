import { AgentResult, ClassifyResult, LlmPort, LlmUnavailableError } from './llm.port';

/** Used when ANTHROPIC_API_KEY is not set: every call fails fast with a clear reason. */
export class DisabledLlm extends LlmPort {
  readonly available = false;

  runAgent(): Promise<AgentResult> {
    return Promise.reject(new LlmUnavailableError('No LLM provider configured'));
  }

  classify(): Promise<ClassifyResult> {
    return Promise.reject(new LlmUnavailableError('No LLM provider configured'));
  }
}
