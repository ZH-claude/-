export type AnnouncementCategory = 'announcement' | 'update_log' | 'usage_guide';

export type PublicAnnouncement = {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategory;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementSection = {
  key: AnnouncementCategory;
  title: string;
  items: PublicAnnouncement[];
};

export type AnnouncementFeedResponse = {
  generatedAt: string;
  total: number;
  sections: AnnouncementSection[];
};

export async function listPublishedAnnouncements() {
  const response = await fetch('/api/announcements', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : `公告加载失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as AnnouncementFeedResponse;
}
