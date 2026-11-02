import { Role } from '../../common/auth/role.enum';
import { TransactionRunner } from '../../infra/database/transaction-runner';
import { generateTicketCode, SupportService } from './support.service';
import { SupportRepository } from './support.repository';
import { TicketCategory, TicketDetail, TicketStatus } from './support.types';

const customer = { id: 'c1', email: 'an@example.com', role: Role.CUSTOMER };
const other = { id: 'c2', email: 'binh@example.com', role: Role.CUSTOMER };
const staff = { id: 's1', email: 'cskh@shopfast.local', role: Role.SUPPORT };
const TX = { tx: true };

function setup() {
  const detail = { id: 't1', customer: { id: 'c1' } } as TicketDetail;
  const tickets = {
    orderOwner: jest.fn().mockResolvedValue('c1'),
    insertTicket: jest.fn().mockResolvedValue('t1'),
    insertMessage: jest.fn(),
    lock: jest.fn().mockResolvedValue({ id: 't1', customerId: 'c1', status: TicketStatus.OPEN }),
    update: jest.fn(),
    detail: jest.fn().mockResolvedValue(detail),
    list: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
  };
  const tx = { run: jest.fn((work: (t: unknown) => Promise<unknown>) => work(TX)) };
  const outbox = { add: jest.fn() };
  const service = new SupportService(
    tickets as unknown as SupportRepository,
    tx as unknown as TransactionRunner,
    outbox,
  );
  return { service, tickets, outbox };
}

describe('SupportService.create', () => {
  it('stores ticket, first message and the classification event in one transaction', async () => {
    const { service, tickets, outbox } = setup();

    await service.create(customer, { subject: 'Hỏi đơn', message: 'Đơn tôi đâu?', orderId: 'o1' });

    expect(tickets.insertTicket).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ customerId: 'c1', orderId: 'o1', subject: 'Hỏi đơn' }),
    );
    expect(tickets.insertMessage).toHaveBeenCalledWith(TX, {
      ticketId: 't1',
      authorId: 'c1',
      fromStaff: false,
      body: 'Đơn tôi đâu?',
    });
    expect(outbox.add).toHaveBeenCalledWith(TX, [
      { type: 'TicketCreated', aggregateId: 't1', payload: { ticketId: 't1' } },
    ]);
  });

  it("refuses to attach someone else's order", async () => {
    const { service, tickets } = setup();
    tickets.orderOwner.mockResolvedValue('c2');
    await expect(
      service.create(customer, { subject: 'x', message: 'y', orderId: 'o9' }),
    ).rejects.toMatchObject({ response: { code: 'TICKET_ORDER_INVALID' } });
    expect(tickets.insertTicket).not.toHaveBeenCalled();
  });
});

describe('SupportService access and replies', () => {
  it("hides another customer's ticket as not found, but staff can read it", async () => {
    const { service } = setup();
    await expect(service.get(other, 't1')).rejects.toMatchObject({
      response: { code: 'TICKET_NOT_FOUND' },
    });
    await expect(service.get(staff, 't1')).resolves.toMatchObject({ id: 't1' });
  });

  it('marks the ticket ANSWERED and assigns it on a staff reply', async () => {
    const { service, tickets } = setup();
    await service.reply(staff, 't1', 'Chào chị');
    expect(tickets.insertMessage).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ fromStaff: true }),
    );
    expect(tickets.update).toHaveBeenCalledWith(TX, 't1', {
      status: TicketStatus.ANSWERED,
      assigneeId: 's1',
    });
  });

  it('re-opens the ticket on a customer follow-up', async () => {
    const { service, tickets } = setup();
    await service.reply(customer, 't1', 'Còn nữa');
    expect(tickets.update).toHaveBeenCalledWith(TX, 't1', {
      status: TicketStatus.OPEN,
      assigneeId: undefined,
    });
  });

  it('refuses replies on closed tickets and on tickets of others', async () => {
    const { service, tickets } = setup();
    await expect(service.reply(other, 't1', 'x')).rejects.toMatchObject({
      response: { code: 'TICKET_NOT_FOUND' },
    });
    tickets.lock.mockResolvedValue({ id: 't1', customerId: 'c1', status: TicketStatus.CLOSED });
    await expect(service.reply(customer, 't1', 'x')).rejects.toMatchObject({
      response: { code: 'TICKET_CLOSED' },
    });
  });

  it('lets staff override the category', async () => {
    const { service, tickets } = setup();
    await service.updateByStaff(staff, 't1', { category: TicketCategory.PAYMENT });
    expect(tickets.update).toHaveBeenCalledWith(TX, 't1', {
      category: TicketCategory.PAYMENT,
      assigneeId: 's1',
    });
  });

  it('lists only the customer’s own tickets', async () => {
    const { service, tickets } = setup();
    await service.listMine(customer, 2, 10);
    expect(tickets.list).toHaveBeenCalledWith({ customerId: 'c1' }, 10, 10);
  });
});

describe('generateTicketCode', () => {
  it('produces readable codes', () => {
    expect(generateTicketCode()).toMatch(/^TK-[A-HJ-NP-Z2-9]{6}$/);
  });
});
