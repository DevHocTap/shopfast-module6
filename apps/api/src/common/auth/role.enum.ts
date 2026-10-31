export enum Role {
  CUSTOMER = 'CUSTOMER',
  SUPPORT = 'SUPPORT',
  WAREHOUSE = 'WAREHOUSE',
  ADMIN = 'ADMIN',
}

/** Staff can see any order; customers only their own. */
export const STAFF_ROLES: readonly Role[] = [Role.SUPPORT, Role.WAREHOUSE, Role.ADMIN];

export function isStaff(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}
