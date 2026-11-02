import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AppError } from '../errors/app-error';
import { AccessTokenClaims, AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './decorators';

/**
 * Global guard: every endpoint requires a valid access token unless marked @Public().
 * On public endpoints a valid token is still attached (e.g. per-user rate limits later).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Global guards also run for WebSocket handlers; sockets authenticate once, at the handshake
    // (TrackingGateway middleware), so there is no per-message HTTP header to check here.
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = extractBearerToken(request);

    if (!token) {
      if (isPublic) return true;
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Bạn cần đăng nhập để tiếp tục.');
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      request.user = { id: claims.sub, email: claims.email, role: claims.role };
      return true;
    } catch (error) {
      if (isPublic) return true;
      const expired = (error as Error).name === 'TokenExpiredError';
      throw new AppError(
        HttpStatus.UNAUTHORIZED,
        expired ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
        expired
          ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          : 'Bạn cần đăng nhập để tiếp tục.',
      );
    }
  }
}

function extractBearerToken(request: Request): string | undefined {
  const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
  return scheme === 'Bearer' && token ? token : undefined;
}
