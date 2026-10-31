import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * `Server-Timing: app;dur=3.2` on every response: browser DevTools show the server's own time,
 * separate from network latency (which, from Vietnam to Sydney, dominates the total).
 */
@Injectable()
export class ServerTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = process.hrtime.bigint();
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap(() => {
        if (response.headersSent) return;
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        response.setHeader('Server-Timing', `app;dur=${ms.toFixed(1)}`);
      }),
    );
  }
}
