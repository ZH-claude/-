import { requireMerchantProfile } from '../merchant-auth';
import { MerchantAiRechargeView } from './merchant-ai-recharge-view';

export const dynamic = 'force-dynamic';

export default async function MerchantAiRechargePage() {
  const profile = await requireMerchantProfile();

  return <MerchantAiRechargeView role={profile.role} username={profile.username} />;
}
