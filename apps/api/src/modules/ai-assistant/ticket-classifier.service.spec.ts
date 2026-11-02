import { DisabledLlm } from '../../infra/llm/disabled-llm.adapter';
import { FakeLlm } from '../../infra/llm/fake-llm';
import { LlmPort } from '../../infra/llm/llm.port';
import { SupportRepository } from '../support/support.repository';
import { TicketCategory } from '../support/support.types';
import { TicketClassifierService } from './ticket-classifier.service';

function setup(llm: LlmPort, category: TicketCategory | null = null) {
  const tickets = {
    classificationInput: jest
      .fn()
      .mockResolvedValue({ subject: 'Hoàn tiền', body: 'Tôi muốn trả hàng <b>gấp</b>', category }),
    saveClassification: jest.fn().mockResolvedValue(true),
  };
  return {
    service: new TicketClassifierService(llm, tickets as unknown as SupportRepository),
    tickets,
  };
}

describe('TicketClassifierService', () => {
  it('stores a confident classification', async () => {
    const { service, tickets } = setup(
      new FakeLlm(undefined, () => ({ label: 'RETURN_REFUND', confidence: 0.93 })),
    );

    await expect(service.classify('t1')).resolves.toBe('classified');
    expect(tickets.saveClassification).toHaveBeenCalledWith(
      't1',
      TicketCategory.RETURN_REFUND,
      0.93,
    );
  });

  it('leaves low-confidence or unknown labels to a human', async () => {
    const low = setup(new FakeLlm(undefined, () => ({ label: 'PAYMENT', confidence: 0.4 })));
    await low.service.classify('t1');
    expect(low.tickets.saveClassification).toHaveBeenCalledWith('t1', 'UNCLASSIFIED', 0.4);

    const odd = setup(new FakeLlm(undefined, () => ({ label: 'HACKED', confidence: 1 })));
    await odd.service.classify('t1');
    expect(odd.tickets.saveClassification).toHaveBeenCalledWith('t1', 'UNCLASSIFIED', 1);
  });

  it('wraps the customer text as data with angle brackets neutralised', async () => {
    const llm = new FakeLlm();
    const classify = jest.spyOn(llm, 'classify');
    await setup(llm).service.classify('t1');

    const input = classify.mock.calls[0][0].input;
    expect(input).toMatch(/^<ticket>/);
    expect(input).toContain('‹b›gấp‹/b›');
    expect(classify.mock.calls[0][0].labels).not.toContain('UNCLASSIFIED');
  });

  it('does nothing for a ticket that is already sorted (re-delivered job)', async () => {
    const llm = new FakeLlm();
    const classify = jest.spyOn(llm, 'classify');
    const { service, tickets } = setup(llm, TicketCategory.PAYMENT);

    await expect(service.classify('t1')).resolves.toBe('already-classified');
    expect(classify).not.toHaveBeenCalled();
    expect(tickets.saveClassification).not.toHaveBeenCalled();
  });

  it('files the ticket as UNCLASSIFIED right away when no provider is configured', async () => {
    const { service, tickets } = setup(new DisabledLlm());
    await service.classify('t1', false);
    expect(tickets.saveClassification).toHaveBeenCalledWith('t1', 'UNCLASSIFIED', 0);
  });

  it('lets the queue retry a transient failure, and gives up gracefully on the last attempt', async () => {
    const llm = new FakeLlm();
    jest.spyOn(llm, 'classify').mockRejectedValue(new Error('overloaded'));
    const { service, tickets } = setup(llm);

    await expect(service.classify('t1', false)).rejects.toThrow('overloaded');
    expect(tickets.saveClassification).not.toHaveBeenCalled();

    await expect(service.classify('t1', true)).resolves.toBe('classified');
    expect(tickets.saveClassification).toHaveBeenCalledWith('t1', 'UNCLASSIFIED', 0);
  });

  it('ignores a ticket that no longer exists', async () => {
    const { service, tickets } = setup(new FakeLlm());
    tickets.classificationInput.mockResolvedValue(null);
    await expect(service.classify('gone')).resolves.toBe('missing');
  });
});
