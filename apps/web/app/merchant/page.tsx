import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isMerchantRole } from '../lib/role-routing';
import type { PublicUser } from '../lib/auth-api';
import { MerchantDashboardView } from './merchant-dashboard-view';

export const dynamic = 'force-dynamic';

type ProfileResponse = {
  user: PublicUser;
};

export default async function MerchantEntryPage() {
  const profile = await getProfileFromRequest();

  if (!profile) {
    redirect('/login');
  }

  if (isMerchantRole(profile.user.role)) {
    return <MerchantDashboardView role={profile.user.role} username={profile.user.username} />;
  }

  redirect('/account/profile');
}

async function getProfileFromRequest() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  if (!cookieHeader) {
    return null;
  }

  const response = await fetch(`${getInternalApiBaseUrl()}/auth/me`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader
    }
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return (await response.json()) as ProfileResponse;
}

function getInternalApiBaseUrl() {
  return (
    process.env.INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    'http://127.0.0.1:3001'
  ).replace(/\/+$/, '');
}
