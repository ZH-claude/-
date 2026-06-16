export type RoutableUser = {
  role?: string | null;
};

const MERCHANT_ROLES = new Set(['admin', 'merchant']);

export function isMerchantRole(role: string | null | undefined) {
  return MERCHANT_ROLES.has((role ?? '').trim().toLowerCase());
}

export function getPostLoginPath(user: RoutableUser) {
  return isMerchantRole(user.role) ? '/merchant' : '/account/profile';
}
