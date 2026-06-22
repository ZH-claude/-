import { requireMerchantProfile } from '../merchant-auth';
import { MerchantAuditView } from './merchant-audit-view';

export const dynamic = 'force-dynamic';

export default async function MerchantAuditPage() {
  const profile = await requireMerchantProfile();

  return <MerchantAuditView role={profile.role} username={profile.username} />;
}
