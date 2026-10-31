import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AppError } from '../errors/app-error';
import { AuthUser } from './auth-user';
import { ROLES_KEY } from './decorators';
import { Role } from './role.enum';

/** Runs after JwtAuthGuard. Endpoints without @Roles() are open to any authenticated user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
    if (user && roles.includes(user.role)) return true;

    throw new AppError(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Bạn không có quyền thực hiện thao tác này.',
    );
  }
}
