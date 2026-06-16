import { requireMerchantProfile } from '../merchant/merchant-auth';
import AdminLegacyView from './admin-legacy-view';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireMerchantProfile();

  return <AdminLegacyView />;
}
