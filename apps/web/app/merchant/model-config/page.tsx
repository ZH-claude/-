import { requireMerchantProfile } from '../merchant-auth';
import { MerchantModelConfigView } from './merchant-model-config-view';

export const dynamic = 'force-dynamic';

export default async function MerchantModelConfigPage() {
  const profile = await requireMerchantProfile();

  return <MerchantModelConfigView role={profile.role} username={profile.username} />;
}
