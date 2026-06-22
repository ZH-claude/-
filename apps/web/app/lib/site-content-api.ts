export type SiteFontFamily = 'system' | 'serif' | 'rounded' | 'mono';

export type SiteContentConfig = {
  id: string;
  home: {
    title: string;
    subtitle: string;
    content: string | null;
    fontFamily: SiteFontFamily;
    textColor: string;
    accentColor: string;
  };
  popup: {
    enabled: boolean;
    title: string | null;
    content: string | null;
    fontFamily: SiteFontFamily;
    textColor: string;
    accentColor: string;
  };
  updatedAt: string | null;
};

export async function getSiteContentConfig() {
  const response = await fetch('/api/site-content', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message : `站点内容加载失败：HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as SiteContentConfig;
}
