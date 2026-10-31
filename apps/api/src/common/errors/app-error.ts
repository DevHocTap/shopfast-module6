import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Business error with a stable machine code and a Vietnamese message for the end user.
 * AllExceptionsFilter renders it as `{ statusCode, code, message, details? }`.
 */
export class AppError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}
