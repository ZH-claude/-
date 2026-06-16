import { requireMerchantProfile } from '../merchant-auth';
import { MerchantDrawingLogsView } from './merchant-drawing-logs-view';

export const dynamic = 'force-dynamic';

export default async function MerchantDrawingLogsPage() {
  const profile = await requireMerchantProfile();

  return <MerchantDrawingLogsView role={profile.role} username={profile.username} />;
}
