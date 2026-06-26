import { defaultLanguage, detectPreferredLanguage, type LanguageCode } from './i18n';
import { pageTerm } from './page-copy-terms';

export class ApiClientError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }
}

export function getApiErrorMessage(language?: string | null, status?: number) {
  const resolvedLanguage = resolveErrorLanguage(language);
  const baseMessage = pageTerm(resolvedLanguage, 'failed');
  return typeof status === 'number' ? `${baseMessage}: HTTP ${status}` : baseMessage;
}

export function createApiClientError(language: string | null | undefined, status: number, data?: unknown) {
  return new ApiClientError(getApiErrorMessage(language, status), status, getErrorCode(data));
}

export function isAuthenticationApiError(error: unknown) {
  return error instanceof ApiClientError && error.status === 401;
}

export function resolveErrorLanguage(language?: string | null): LanguageCode {
  if (!language) {
    return defaultLanguage;
  }

  return detectPreferredLanguage([language]);
}

function getErrorCode(data: unknown) {
  if (!data || typeof data !== 'object' || !('code' in data)) {
    return null;
  }

  const code = (data as { code: unknown }).code;
  return typeof code === 'string' && code.trim() ? code : null;
}
