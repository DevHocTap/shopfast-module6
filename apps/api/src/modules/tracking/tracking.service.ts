import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenClaims, AuthUser } from '../../common/auth/auth-user';
import { isStaff } from '../../common/auth/role.enum';
import { HandshakeError } from './tracking.events';
import { TrackingRepository } from './tracking.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HandshakeRejected extends Error {
  constructor(readonly code: HandshakeError) {
    super(code);
  }
}

export interface SocketSession {
  user: AuthUser;
  /** Epoch ms when the access token expires: the socket is closed then and must re-authenticate. */
  expiresAt: number;
}

/** Decisions behind the tracking gateway, free of Socket.IO types (unit-tested on its own). */
@Injectable()
export class TrackingService {
  constructor(
    private readonly jwt: JwtService,
    private readonly repository: TrackingRepository,
  ) {}

  /** Same access token and checks as the HTTP API; refused tokens never reach the namespace. */
  async authenticate(token: unknown): Promise<SocketSession> {
    if (typeof token !== 'string' || token.length === 0) {
      throw new HandshakeRejected('UNAUTHORIZED');
    }
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims & { exp: number }>(token);
      return {
        user: { id: claims.sub, email: claims.email, role: claims.role },
        expiresAt: claims.exp * 1000,
      };
    } catch (error) {
      throw new HandshakeRejected(
        (error as Error).name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED',
      );
    }
  }

  /** Returns the order id when the payload is well-formed. */
  parseOrderId(payload: unknown): string | null {
    const orderId = (payload as { orderId?: unknown } | null)?.orderId;
    return typeof orderId === 'string' && UUID.test(orderId) ? orderId.toLowerCase() : null;
  }

  /**
   * Customers follow only their own orders; staff (support, warehouse, admin) follow any order.
   * A missing order and someone else's order give the same answer: existence is not revealed.
   */
  async canWatch(user: AuthUser, orderId: string): Promise<boolean> {
    if (isStaff(user.role)) return true;
    return (await this.repository.ownerOf(orderId)) === user.id;
  }
}
