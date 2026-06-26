import { ApiClientError, createApiClientError } from './api-error-copy';

export type ExperienceModel = {
  model: string;
  displayName: string | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  groupMultiplier: string;
  supportsStream: boolean;
};

export type ExperienceChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ExperienceChatResponse = {
  requestId: string;
  model: string;
  message: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  billing: {
    usageEventId: string | null;
    costCents: number;
    status: string;
    walletTransactionId: string | null;
    balanceAfterCents: number | null;
  };
  token: {
    id: string;
    name: string;
    keyPreview: string;
  };
};

export class ExperienceApiError extends ApiClientError {
  constructor(message: string, status: number, code: string | null) {
    super(message, status, code);
    this.name = 'ExperienceApiError';
    Object.setPrototypeOf(this, ExperienceApiError.prototype);
  }
}

const API_BASE_URL = '/api';

export async function listExperienceModels(language?: string) {
  return request<{ items: ExperienceModel[] }>(withLanguage('/experience/models', language), {}, language);
}

export async function sendExperienceChat(payload: {
  model: string;
  messages: ExperienceChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}, language?: string) {
  return request<ExperienceChatResponse>('/experience/chat', {
    method: 'POST',
    body: payload
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
    cache: 'no-store',
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const error = createApiClientError(language, response.status, data);
    throw new ExperienceApiError(error.message, error.status, error.code);
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
