import { requireMerchantProfile } from './merchant-auth';
import { MerchantDashboardView } from './merchant-dashboard-view';

export const dynamic = 'force-dynamic';

export default async function MerchantEntryPage() {
  const profile = await requireMerchantProfile();

  return <MerchantDashboardView role={profile.role} username={profile.username} />;
}
