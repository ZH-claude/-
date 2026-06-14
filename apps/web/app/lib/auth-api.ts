export type PublicUser = {
  id: string;
  username: string;
  status: string;
  role: string;
  inviteCode: string;
  timezone: string;
  lastLoginAt: string | null;
  createdAt: string;
  group: {
    id: string;
    code: string;
    name: string;
  };
  wallet: {
    balanceCents: number;
    totalSpendCents: number;
  };
};

type AuthResponse = {
  user: PublicUser;
};

type ProfileResponse = {
  user: PublicUser;
};

const API_BASE_URL = '/api';

export async function register(payload: { username: string; password: string; inviteCode?: string }) {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: payload
  });
}

export async function login(payload: { username: string; password: string }) {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: payload
  });
}

export async function getProfile() {
  return request<ProfileResponse>('/auth/me');
}

export async function changePassword(
  payload: { currentPassword: string; newPassword: string }
) {
  return request<ProfileResponse>('/auth/change-password', {
    method: 'POST',
    body: payload
  });
}

export async function logout() {
  return request<{ ok: boolean }>('/auth/logout', {
    method: 'POST'
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
