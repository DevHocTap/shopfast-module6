import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser } from './auth-user';
import { Role } from './role.enum';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Endpoint reachable without a token. A valid token is still read when present. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restrict an endpoint to the given roles (checked by RolesGuard after authentication). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return request.user;
});
