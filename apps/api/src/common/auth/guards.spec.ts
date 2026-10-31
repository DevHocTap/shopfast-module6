import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Role } from './role.enum';
import { RolesGuard } from './roles.guard';

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflectorWith(metadata: Record<string, unknown>): Reflector {
  return { getAllAndOverride: (key: string) => metadata[key] } as unknown as Reflector;
}

describe('JwtAuthGuard', () => {
  const claims = { sub: 'u1', email: 'an@example.com', role: Role.CUSTOMER };

  function guard(metadata: Record<string, unknown>, verify: jest.Mock) {
    return new JwtAuthGuard(
      { verifyAsync: verify } as unknown as JwtService,
      reflectorWith(metadata),
    );
  }

  it('attaches the user from a valid bearer token', async () => {
    const request: Record<string, unknown> = { headers: { authorization: 'Bearer good' } };

    await expect(
      guard({}, jest.fn().mockResolvedValue(claims)).canActivate(context(request)),
    ).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u1', email: 'an@example.com', role: Role.CUSTOMER });
  });

  it('rejects a protected route without a token', async () => {
    await expect(guard({}, jest.fn()).canActivate(context({ headers: {} }))).rejects.toMatchObject({
      response: { code: 'UNAUTHORIZED' },
    });
  });

  it('tells the client when the token has expired', async () => {
    const expired = Object.assign(new Error('jwt expired'), { name: 'TokenExpiredError' });
    const request = { headers: { authorization: 'Bearer old' } };

    await expect(
      guard({}, jest.fn().mockRejectedValue(expired)).canActivate(context(request)),
    ).rejects.toMatchObject({
      response: { code: 'TOKEN_EXPIRED' },
    });
  });

  it('lets public routes through, with or without a valid token', async () => {
    const publicRoute = { [IS_PUBLIC_KEY]: true };

    await expect(guard(publicRoute, jest.fn()).canActivate(context({ headers: {} }))).resolves.toBe(
      true,
    );
    await expect(
      guard(publicRoute, jest.fn().mockRejectedValue(new Error('bad'))).canActivate(
        context({ headers: { authorization: 'Bearer bad' } }),
      ),
    ).resolves.toBe(true);
  });
});

describe('RolesGuard', () => {
  const guard = (roles?: Role[]) => new RolesGuard(reflectorWith({ [ROLES_KEY]: roles }));

  it('allows any authenticated user when no role is required', () => {
    expect(guard(undefined).canActivate(context({ user: { role: Role.CUSTOMER } }))).toBe(true);
  });

  it('allows a matching role and forbids others', () => {
    expect(guard([Role.WAREHOUSE]).canActivate(context({ user: { role: Role.WAREHOUSE } }))).toBe(
      true,
    );
    let thrown: unknown;
    try {
      guard([Role.WAREHOUSE]).canActivate(context({ user: { role: Role.CUSTOMER } }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ response: { code: 'FORBIDDEN' } });
  });
});
