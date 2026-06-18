import { requireMerchantProfile } from '../merchant-auth';
import { MerchantModelConfigView } from '../model-config/merchant-model-config-view';

export const dynamic = 'force-dynamic';

export default async function MerchantModelRoutesPage() {
  const profile = await requireMerchantProfile();

  return <MerchantModelConfigView mode="routes" role={profile.role} username={profile.username} />;
}
