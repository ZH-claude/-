import { createApiClientError } from './api-error-copy';

export type PublicUser = {
  id: string;
  username: string;
  phoneNumber: string | null;
  phoneVerifiedAt: string | null;
  status: string;
  role: string;
  timezone: string;
  lastLoginIp: string | null;
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
  metrics: {
    totalCallCount: number;
    activeTokenCount: number;
  };
  availableModels: AvailableModel[];
};

export type AvailableModel = {
  model: string;
  displayName: string | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  groupMultiplier: string;
  supportsStream: boolean;
};

type AuthResponse = {
  user: PublicUser;
};

type ProfileResponse = {
  user: PublicUser;
};

const API_BASE_URL = '/api';

export async function register(payload: { username: string; password: string; phoneNumber?: string }, language?: string) {
  return request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: payload
  }, language);
}

export async function login(payload: { username: string; password: string }, language?: string) {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: payload
  }, language);
}

export async function phoneLogin(payload: { phoneNumber: string; password: string }, language?: string) {
  return request<AuthResponse>('/auth/phone-login', {
    method: 'POST',
    body: payload
  }, language);
}

export async function requestPasswordRecovery(payload: { phoneNumber: string }, language?: string) {
  return request<{ ok: boolean; channel: 'phone'; providerConfigured: boolean; message: string; debugCode?: string }>('/auth/password-recovery/request', {
    method: 'POST',
    body: payload
  }, language);
}

export async function resetPasswordByPhone(payload: { phoneNumber: string; verificationCode: string; newPassword: string }, language?: string) {
  return request<{ ok: boolean; message?: string }>('/auth/password-recovery/reset', {
    method: 'POST',
    body: payload
  }, language);
}

export async function getProfile(language?: string) {
  return request<ProfileResponse>(withLanguage('/auth/me', language), {}, language);
}

export async function changePassword(
  payload: { currentPassword: string; newPassword: string },
  language?: string
) {
  return request<ProfileResponse>('/auth/change-password', {
    method: 'POST',
    body: payload
  }, language);
}

export async function updateTimezone(payload: { timezone: string }, language?: string) {
  return request<ProfileResponse>('/auth/timezone', {
    method: 'POST',
    body: payload
  }, language);
}

export async function logout(language?: string) {
  return request<{ ok: boolean }>('/auth/logout', {
    method: 'POST'
  }, language);
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
  } = {},
  language?: string
) {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (language) {
    headers['Accept-Language'] = language;
  }

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
    throw createApiClientError(language, response.status, data);
  }

  return data as T;
}

function withLanguage(path: string, language?: string) {
  if (!language) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${new URLSearchParams({ language }).toString()}`;
}
