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

const API_BASE_URL = '/api';

export async function listExperienceModels() {
  return request<{ items: ExperienceModel[] }>('/experience/models');
}

export async function sendExperienceChat(payload: {
  model: string;
  messages: ExperienceChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}) {
  return request<ExperienceChatResponse>('/experience/chat', {
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
