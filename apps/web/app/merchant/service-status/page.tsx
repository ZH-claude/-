import { requireMerchantProfile } from '../merchant-auth';
import { MerchantServiceStatusView } from './merchant-service-status-view';

export const dynamic = 'force-dynamic';

export default async function MerchantServiceStatusPage() {
  const profile = await requireMerchantProfile();

  return <MerchantServiceStatusView role={profile.role} username={profile.username} />;
}
