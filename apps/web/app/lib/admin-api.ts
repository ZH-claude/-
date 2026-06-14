export type AdminUser = {
  id: string;
  username: string;
  role: string;
  status: string;
  timezone: string;
  group: {
    id: string;
    code: string;
    name: string;
  };
  wallet: {
    balanceCents: number;
    totalSpendCents?: number;
  };
  lastLoginAt: string | null;
  createdAt: string;
};

export type Announcement = {
  id: string;
  title: string;
  content: string;
  status: string;
  publishedAt: string | null;
  createdBy?: string;
  createdByAdminId?: string;
  createdAt: string;
  updatedAt?: string;
};

type UserListResponse = {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
};

type AnnouncementListResponse = {
  items: Announcement[];
};

const API_BASE_URL = '/api';

export async function listAdminUsers() {
  return request<UserListResponse>('/admin/users?limit=100');
}

export async function listAnnouncements() {
  return request<AnnouncementListResponse>('/admin/announcements');
}

export async function createAnnouncement(payload: { title: string; content: string; status: 'draft' | 'published' }) {
  return request<Announcement>('/admin/announcements', {
    method: 'POST',
    body: payload
  });
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
  } = {}
) {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : `请求失败：${response.status}`;
    throw new Error(message);
  }

  return data as T;
}
