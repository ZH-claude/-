import { requireMerchantProfile } from '../merchant-auth';
import { MerchantUsersView } from './merchant-users-view';

export const dynamic = 'force-dynamic';

export default async function MerchantUsersPage() {
  const profile = await requireMerchantProfile();

  return <MerchantUsersView role={profile.role} username={profile.username} />;
}
