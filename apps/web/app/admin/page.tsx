import { redirect } from 'next/navigation';
import { requireMerchantProfile } from '../merchant/merchant-auth';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  await requireMerchantProfile();
  redirect('/merchant');
}
