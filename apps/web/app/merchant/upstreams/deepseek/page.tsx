import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MerchantDeepSeekUpstreamPage() {
  redirect('/merchant/model-routes');
}
