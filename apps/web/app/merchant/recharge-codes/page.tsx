import { requireMerchantProfile } from '../merchant-auth';
import { MerchantRechargeCodesView } from './merchant-recharge-codes-view';

export const dynamic = 'force-dynamic';

export default async function MerchantRechargeCodesPage() {
  const profile = await requireMerchantProfile();

  return <MerchantRechargeCodesView role={profile.role} username={profile.username} />;
}
