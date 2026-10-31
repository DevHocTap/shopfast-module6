import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DEFAULT_MESSAGES_VI, INTERNAL_ERROR_MESSAGE_VI } from './messages.vi';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/**
 * Unified error contract: `{ statusCode, code, message, details?, requestId }`.
 * Messages are Vietnamese; internals (stack, SQL, driver errors) never leave the server.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();
    const body = toErrorBody(exception, request.id);

    if (body.statusCode >= 500) {
      this.logger.error(
        { err: exception, requestId: request.id, path: request.url },
        'Unhandled exception',
      );
    }
    response.status(body.statusCode).json(body);
  }
}

export function toErrorBody(exception: unknown, requestId?: string): ErrorBody {
  if (!(exception instanceof HttpException)) {
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: INTERNAL_ERROR_MESSAGE_VI,
      requestId,
    };
  }

  const statusCode = exception.getStatus();
  const payload = exception.getResponse();
  const fallback = DEFAULT_MESSAGES_VI[statusCode] ?? INTERNAL_ERROR_MESSAGE_VI;
  const body: ErrorBody = {
    statusCode,
    code: (HttpStatus as Record<number, string | undefined>)[statusCode] ?? 'ERROR',
    message: fallback,
    requestId,
  };

  if (typeof payload === 'object' && payload !== null) {
    const { code, message, details } = payload as Record<string, unknown>;
    // Errors thrown by our own code carry an explicit machine code and a Vietnamese message.
    if (typeof code === 'string' && typeof message === 'string') {
      body.code = code;
      body.message = message;
    }
    // class-validator returns a list of field errors.
    if (Array.isArray(message)) body.details = message;
    if (details !== undefined) body.details = details;
  }
  return body;
}
