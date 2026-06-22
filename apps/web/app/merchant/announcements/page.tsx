import { requireMerchantProfile } from '../merchant-auth';
import { MerchantAnnouncementsView } from './merchant-announcements-view';

export const dynamic = 'force-dynamic';

export default async function MerchantAnnouncementsPage() {
  const profile = await requireMerchantProfile();

  return <MerchantAnnouncementsView role={profile.role} username={profile.username} />;
}
