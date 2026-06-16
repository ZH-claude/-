import { requireMerchantProfile } from '../merchant-auth';
import { MerchantRequestLogsView } from './merchant-request-logs-view';

export const dynamic = 'force-dynamic';

export default async function MerchantRequestLogsPage() {
  const profile = await requireMerchantProfile();

  return <MerchantRequestLogsView role={profile.role} username={profile.username} />;
}
