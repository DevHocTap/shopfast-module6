import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter, toErrorBody } from './all-exceptions.filter';
import { DEFAULT_MESSAGES_VI, INTERNAL_ERROR_MESSAGE_VI } from './messages.vi';

describe('toErrorBody', () => {
  it('hides internals of unknown errors behind a generic 500', () => {
    const body = toErrorBody(new Error('relation "orders" does not exist'), 'req-1');

    expect(body).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: INTERNAL_ERROR_MESSAGE_VI,
      requestId: 'req-1',
    });
  });

  it('replaces framework English messages with the Vietnamese default', () => {
    const body = toErrorBody(new NotFoundException('Cannot GET /api/nope'));

    expect(body.code).toBe('NOT_FOUND');
    expect(body.message).toBe(DEFAULT_MESSAGES_VI[HttpStatus.NOT_FOUND]);
  });

  it('keeps validation errors as details', () => {
    const body = toErrorBody(new BadRequestException(['email must be an email']));

    expect(body.statusCode).toBe(400);
    expect(body.details).toEqual(['email must be an email']);
  });

  it('uses the explicit code and message of application errors', () => {
    const body = toErrorBody(
      new ConflictException({ code: 'OUT_OF_STOCK', message: 'Sản phẩm không đủ hàng.' }),
    );

    expect(body).toMatchObject({
      statusCode: 409,
      code: 'OUT_OF_STOCK',
      message: 'Sản phẩm không đủ hàng.',
    });
  });
});

describe('AllExceptionsFilter', () => {
  it('writes the error body with the matching status', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ id: 'req-2', url: '/api/x' }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(new NotFoundException(), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-2' }));
  });
});
