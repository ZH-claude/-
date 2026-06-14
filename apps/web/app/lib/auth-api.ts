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
  token: string;
  user: PublicUser;
};

type ProfileResponse = {
  user: PublicUser;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const SESSION_TOKEN_KEY = 'nested_api_relay_session';

export function getStoredToken() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

export function storeToken(token: string) {
  window.localStorage.setItem(SESSION_TOKEN_KEY, token);
}

export function clearStoredToken() {
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

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

export async function getProfile(token: string) {
  return request<ProfileResponse>('/auth/me', {
    token
  });
}

export async function changePassword(
  token: string,
  payload: { currentPassword: string; newPassword: string }
) {
  return request<ProfileResponse>('/auth/change-password', {
    method: 'POST',
    token,
    body: payload
  });
}

export async function logout(token: string) {
  return request<{ ok: boolean }>('/auth/logout', {
    method: 'POST',
    token
  });
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    token?: string;
    body?: Record<string, unknown>;
  } = {}
) {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
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
