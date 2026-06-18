import { requireMerchantProfile } from '../../merchant-auth';
import { MerchantUpstreamWorkbench } from '../merchant-upstream-workbench';

export const dynamic = 'force-dynamic';

export default async function MerchantRelayUpstreamPage() {
  const profile = await requireMerchantProfile();

  return (
    <MerchantUpstreamWorkbench
      activePath="/merchant/upstreams/relay"
      kind="relay"
      role={profile.role}
      username={profile.username}
    />
  );
}
