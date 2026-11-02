import Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlmAdapter, MessagesClient } from './anthropic-llm.adapter';
import { LlmUnavailableError } from './llm.port';

const options = { model: 'claude-opus-5-5', timeoutMs: 20_000 };

function stub(...responses: unknown[]) {
  const create = jest.fn();
  for (const response of responses) create.mockResolvedValueOnce(response);
  const client = { beta: { messages: { create } } } as unknown as MessagesClient;
  return { adapter: new AnthropicLlmAdapter(client, options), create };
}

const toolUse = (id: string, name: string, input: unknown) => ({
  stop_reason: 'tool_use',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'tool_use', id, name, input },
  ],
});
const answer = (text: string, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [{ type: 'text', text }],
});

describe('AnthropicLlmAdapter.runAgent', () => {
  const request = {
    system: 'sys',
    turns: [{ role: 'user' as const, content: 'Đơn SF-7KQ2M9XA?' }],
    tools: [{ name: 'get_order_status', description: 'd', inputSchema: { type: 'object' } }],
    maxToolRounds: 5,
  };

  it('runs tools, sends results back with the full assistant content, and returns the answer', async () => {
    const { adapter, create } = stub(
      toolUse('tu1', 'get_order_status', { order_code: 'SF-7KQ2M9XA' }),
      answer('Đang giao.'),
    );
    const runTool = jest.fn().mockResolvedValue({ content: '{"found":true}' });

    const result = await adapter.runAgent({ ...request, runTool });

    expect(result).toEqual({
      text: 'Đang giao.',
      stopReason: 'end_turn',
      toolCalls: [
        {
          name: 'get_order_status',
          input: { order_code: 'SF-7KQ2M9XA' },
          output: '{"found":true}',
          isError: false,
        },
      ],
    });
    const first = create.mock.calls[0][0];
    expect(first).toMatchObject({
      model: 'claude-opus-5-5',
      thinking: { type: 'adaptive' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    expect(first.tools[0]).toMatchObject({ name: 'get_order_status', strict: true });
    const second = create.mock.calls[1][0];
    // Thinking block passed back unchanged, then one user message holding every tool_result.
    expect(second.messages[1].content[0]).toMatchObject({ type: 'thinking' });
    expect(second.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: '{"found":true}', is_error: false },
      ],
    });
  });

  it('stops at the round cap', async () => {
    const { adapter } = stub(
      toolUse('a', 'get_order_status', {}),
      toolUse('b', 'get_order_status', {}),
    );
    const result = await adapter.runAgent({
      ...request,
      maxToolRounds: 1,
      runTool: jest.fn().mockResolvedValue({ content: '{}' }),
    });
    expect(result.stopReason).toBe('max_rounds');
  });

  it('turns a failing tool into an error result instead of crashing the loop', async () => {
    const { adapter, create } = stub(toolUse('tu1', 'get_order_status', {}), answer('Xin lỗi.'));
    await adapter.runAgent({ ...request, runTool: jest.fn().mockRejectedValue(new Error('db')) });
    expect(create.mock.calls[1][0].messages[2].content[0]).toMatchObject({ is_error: true });
  });

  it('reports a refusal', async () => {
    const { adapter } = stub(answer('', 'refusal'));
    await expect(adapter.runAgent({ ...request, runTool: jest.fn() })).resolves.toMatchObject({
      stopReason: 'refusal',
    });
  });

  it('maps provider outages to LlmUnavailableError', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Anthropic.APIConnectionError({ message: 'offline' }));
    const adapter = new AnthropicLlmAdapter({ beta: { messages: { create } } }, options);
    await expect(adapter.runAgent({ ...request, runTool: jest.fn() })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
  });
});

describe('AnthropicLlmAdapter.classify', () => {
  const request = { system: 's', input: '<ticket>x</ticket>', labels: ['PAYMENT', 'OTHER'] };

  it('asks for schema-constrained JSON and clamps the confidence', async () => {
    const { adapter, create } = stub(answer('{"category":"PAYMENT","confidence":1.4}'));

    await expect(adapter.classify(request)).resolves.toEqual({ label: 'PAYMENT', confidence: 1 });
    expect(create.mock.calls[0][0].output_config).toMatchObject({
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: { properties: { category: { enum: ['PAYMENT', 'OTHER'] } } },
      },
    });
  });

  it('treats a refusal as unclassified', async () => {
    const { adapter } = stub(answer('', 'refusal'));
    await expect(adapter.classify(request)).resolves.toEqual({
      label: 'UNCLASSIFIED',
      confidence: 0,
    });
  });
});
