export type UserRole =
  | 'user' | 'support' | 'compliance'
  | 'finance' | 'devops' | 'admin' | 'superadmin';

export const ROLE_LEVELS: Record<UserRole, number> = {
  user: 0, support: 1, compliance: 2,
  finance: 3, devops: 4, admin: 5, superadmin: 6,
};

export function hasRole(
  user: { role?: UserRole; is_admin?: boolean } | null,
  minRole: UserRole,
): boolean {
  if (!user) return false;
  const eff: UserRole = user.role ?? (user.is_admin ? 'admin' : 'user');
  return (ROLE_LEVELS[eff] ?? 0) >= ROLE_LEVELS[minRole];
}
