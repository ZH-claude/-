import { requireMerchantProfile } from '../../merchant-auth';
import { MerchantUpstreamWorkbench } from '../merchant-upstream-workbench';

export const dynamic = 'force-dynamic';

export default async function MerchantDeepSeekUpstreamPage() {
  const profile = await requireMerchantProfile();

  return (
    <MerchantUpstreamWorkbench
      activePath="/merchant/upstreams/deepseek"
      kind="deepseek"
      role={profile.role}
      username={profile.username}
    />
  );
}
