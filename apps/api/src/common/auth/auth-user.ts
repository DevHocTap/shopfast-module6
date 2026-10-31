import { Role } from './role.enum';

/** Identity attached to the request by JwtAuthGuard (from the access token claims). */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
}
