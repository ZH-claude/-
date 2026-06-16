import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { decryptUpstreamApiKey } from '../admin/upstream-key-crypto';
import { BillingService } from '../billing/billing.service';
import { ModelStatus, UpstreamProviderStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';
import { RequestLogsService } from '../request-logs/request-logs.service';
import { TokensService } from '../tokens/tokens.service';
import { RelayPolicyService } from './relay-policy.service';

type RelayJsonResult = {
  stream: false;
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

type RelayStreamResult = {
  stream: true;
  status: number;
  headers: Record<string, string>;
  upstreamResponse: Response;
};

type ChatCompletionInput = {
  apiKey: string;
  body: unknown;
  requestId: string;
  clientIp: string | null;
  acceptHeader?: string;
};

type ChatCompletionBody = {
  model: string;
  messages: unknown[];
  stream?: boolean;
  [key: string]: unknown;
};

type RelayRequestLogInput = {
  requestId: string;
  userId?: string | null;
  tokenId?: string | null;
  upstreamProviderId?: string | null;
  method: string;
  path: string;
  model?: string | null;
  statusCode?: number | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  upstreamLatencyMs?: number | null;
  upstreamStatusCode?: number | null;
  upstreamStatus?: string | null;
};

export class RelayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly type: string,
    message: string
  ) {
    super(message);
  }
}

const UPSTREAM_TIMEOUT_MS = 120_000;
const RETRYABLE_UPSTREAM_STATUS = new Set([502, 503, 504]);

@Injectable()
export class RelayService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TokensService) private readonly tokensService: TokensService,
    @Inject(BillingService) private readonly billingService: BillingService,
    @Inject(RelayPolicyService) private readonly relayPolicyService: RelayPolicyService,
    @Inject(RequestLogsService) private readonly requestLogsService: RequestLogsService
  ) {}

  createRequestId() {
    return `req_${randomUUID().replace(/-/g, '')}`;
  }

  createError(status: number, code: string, type: string, message: string) {
    return new RelayHttpError(status, code, type, message);
  }

  async recordRejectedRelayRequest(input: {
    requestId: string;
    method: string;
    path: string;
    model?: string | null;
    startedAt: number;
    error: unknown;
  }) {
    const normalizedError = this.normalizeError(input.error);
    await this.recordRequestLogIfAbsentSafe({
      requestId: input.requestId,
      method: input.method,
      path: input.path,
      model: input.model ?? null,
      statusCode: normalizedError.status,
      errorCode: normalizedError.code,
      latencyMs: Date.now() - input.startedAt,
      upstreamLatencyMs: null,
      upstreamStatusCode: null,
      upstreamStatus: 'rejected'
    });
  }

  normalizeError(error: unknown) {
    if (error instanceof RelayHttpError) {
      return error;
    }

    if (error instanceof UnauthorizedException) {
      return this.createError(401, 'invalid_api_key', 'authentication_error', 'Invalid API key');
    }

    if (error instanceof ForbiddenException) {
      const response = error.getResponse();
      const code = response && typeof response === 'object' && 'code' in response ? String(response.code) : '';
      switch (code) {
        case 'insufficient_balance':
          return this.createError(
            402,
            'insufficient_balance',
            'billing_error',
            this.normalizeExceptionMessage(error, 'API token quota exceeded')
          );
        case 'rate_limit_exceeded':
          return this.createError(429, 'rate_limit_exceeded', 'rate_limit_error', this.normalizeExceptionMessage(error, 'Rate limit exceeded'));
        case 'risk_limit_exceeded':
          return this.createError(429, 'risk_limit_exceeded', 'rate_limit_error', this.normalizeExceptionMessage(error, 'Risk control blocked the request'));
        case 'ip_not_allowed':
          return this.createError(403, 'ip_not_allowed', 'permission_error', this.normalizeExceptionMessage(error, 'Client IP is not allowed'));
        case 'ip_required':
          return this.createError(403, 'ip_required', 'permission_error', this.normalizeExceptionMessage(error, 'Client IP is required'));
        case 'token_activation_expired':
          return this.createError(403, 'token_activation_expired', 'permission_error', this.normalizeExceptionMessage(error, 'API token activation window expired'));
      }

      return this.createError(403, 'token_disabled', 'authentication_error', this.normalizeExceptionMessage(error, 'Token is not allowed'));
    }

    if (error instanceof Error && error.name === 'AbortError') {
      return this.createError(408, 'upstream_timeout', 'upstream_error', 'Upstream request timed out');
    }

    return this.createError(500, 'internal_error', 'server_error', 'Internal server error');
  }

  async listModels(apiKey: string, requestId: string, clientIp: string | null) {
    const startedAt = Date.now();
    let userId: string | null = null;
    let tokenId: string | null = null;

    try {
      const auth = await this.tokensService.verifyApiToken(apiKey);
      userId = auth.user.id;
      tokenId = auth.token.id;
      await this.relayPolicyService.assertAllowed({
        requestId,
        user: auth.user,
        token: auth.token,
        model: null,
        clientIp
      });
      await this.tokensService.activateApiTokenIfNeeded(auth.token);
      await this.recordRequestLogSafe({
        requestId,
        userId,
        tokenId,
        method: 'GET',
        path: '/v1/models',
        model: null,
        statusCode: 200,
        errorCode: null,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs: null,
        upstreamStatusCode: null,
        upstreamStatus: 'not_required'
      });

      return {
        object: 'list',
        data: auth.allowedModels.map((model) => ({
          id: model.model,
          object: 'model',
          owned_by: 'nested-relay'
        })),
        request_id: requestId
      };
    } catch (error) {
      const normalizedError = this.normalizeError(error);
      await this.recordRequestLogIfAbsentSafe({
        requestId,
        userId,
        tokenId,
        method: 'GET',
        path: '/v1/models',
        model: null,
        statusCode: normalizedError.status,
        errorCode: normalizedError.code,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs: null,
        upstreamStatusCode: null,
        upstreamStatus: 'rejected'
      });
      throw error;
    }
  }

  async createChatCompletion(input: ChatCompletionInput): Promise<RelayJsonResult | RelayStreamResult> {
    const startedAt = Date.now();
    let userId: string | null = null;
    let tokenId: string | null = null;
    let upstreamProviderId: string | null = null;
    let model: string | null = null;

    try {
    const auth = await this.tokensService.verifyApiToken(input.apiKey);
    userId = auth.user.id;
    tokenId = auth.token.id;
    const body = this.normalizeChatCompletionBody(input.body);
    model = body.model;
    const allowedModel = auth.allowedModels.find((model) => model.model === body.model);
    if (!allowedModel) {
      throw this.createError(403, 'model_not_allowed', 'permission_error', 'Model is not allowed for this API key');
    }

    await this.relayPolicyService.assertAllowed({
      requestId: input.requestId,
      user: auth.user,
      token: auth.token,
      model: body.model,
      clientIp: input.clientIp
    });

    const mapping = await this.findUpstreamMapping(body.model, Boolean(body.stream));
    upstreamProviderId = mapping.provider.id;
    const billingPrincipal = {
      userId: auth.user.id,
      tokenId: auth.token.id
    };
    const billingTarget = {
      providerId: mapping.provider.id,
      upstreamModel: mapping.upstreamModel
    };
    await this.billingService.assertCanStartUsage(auth.user.id, allowedModel);
    await this.tokensService.activateApiTokenIfNeeded(auth.token);

    const upstreamBody = {
      ...body,
      model: mapping.upstreamModel
    };
    const upstreamApiKey = decryptUpstreamApiKey(mapping.provider.encryptedApiKey);

    if (body.stream) {
      let upstreamResponse: Response;
      const upstreamStartedAt = Date.now();
      let upstreamLatencyMs: number | null = null;

      try {
        upstreamResponse = await this.fetchUpstreamChatCompletion(mapping.provider.baseUrl, upstreamApiKey, upstreamBody, {
          stream: true,
          acceptHeader: input.acceptHeader
        });
        upstreamLatencyMs = Date.now() - upstreamStartedAt;
      } catch (error) {
        upstreamLatencyMs = Date.now() - upstreamStartedAt;
        const normalizedError = this.normalizeError(error);
        await this.billingService.recordFailedChat({
          requestId: input.requestId,
          principal: billingPrincipal,
          model: allowedModel,
          upstream: billingTarget,
          errorCode: normalizedError.code
        });
        await this.recordRequestLogSafe({
          requestId: input.requestId,
          userId: auth.user.id,
          tokenId: auth.token.id,
          upstreamProviderId: mapping.provider.id,
          method: 'POST',
          path: '/v1/chat/completions',
          model: body.model,
          statusCode: normalizedError.status,
          errorCode: normalizedError.code,
          latencyMs: Date.now() - startedAt,
          upstreamLatencyMs,
          upstreamStatusCode: null,
          upstreamStatus: 'failed'
        });
        throw error;
      }

      if (!upstreamResponse.ok) {
        const upstreamError = await this.createUpstreamError(upstreamResponse);
        await this.billingService.recordFailedChat({
          requestId: input.requestId,
          principal: billingPrincipal,
          model: allowedModel,
          upstream: billingTarget,
          errorCode: upstreamError.code
        });
        await this.recordRequestLogSafe({
          requestId: input.requestId,
          userId: auth.user.id,
          tokenId: auth.token.id,
          upstreamProviderId: mapping.provider.id,
          method: 'POST',
          path: '/v1/chat/completions',
          model: body.model,
          statusCode: upstreamError.status,
          errorCode: upstreamError.code,
          latencyMs: Date.now() - startedAt,
          upstreamLatencyMs,
          upstreamStatusCode: upstreamResponse.status,
          upstreamStatus: 'http_error'
        });
        throw upstreamError;
      }

      const billingRecord = await this.billingService.recordMeteringUnknownChat({
        requestId: input.requestId,
        principal: billingPrincipal,
        model: allowedModel,
        upstream: billingTarget
      });
      await this.recordRequestLogSafe({
        requestId: input.requestId,
        userId: auth.user.id,
        tokenId: auth.token.id,
        upstreamProviderId: mapping.provider.id,
        method: 'POST',
        path: '/v1/chat/completions',
        model: body.model,
        statusCode: upstreamResponse.status,
        errorCode: null,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs,
        upstreamStatusCode: upstreamResponse.status,
        upstreamStatus: 'stream_started'
      });

      return {
        stream: true,
        status: upstreamResponse.status,
        headers: this.buildStreamHeaders(input.requestId, upstreamResponse, billingRecord.usageEventId),
        upstreamResponse
      };
    }

    let upstreamResponse: Response;
    const upstreamStartedAt = Date.now();
    let upstreamLatencyMs: number | null = null;

    try {
      upstreamResponse = await this.fetchUpstreamChatCompletionWithRetry(mapping.provider.baseUrl, upstreamApiKey, upstreamBody);
      upstreamLatencyMs = Date.now() - upstreamStartedAt;
    } catch (error) {
      upstreamLatencyMs = Date.now() - upstreamStartedAt;
      const normalizedError = this.normalizeError(error);
      await this.billingService.recordFailedChat({
        requestId: input.requestId,
        principal: billingPrincipal,
        model: allowedModel,
        upstream: billingTarget,
        errorCode: normalizedError.code
      });
      await this.recordRequestLogSafe({
        requestId: input.requestId,
        userId: auth.user.id,
        tokenId: auth.token.id,
        upstreamProviderId: mapping.provider.id,
        method: 'POST',
        path: '/v1/chat/completions',
        model: body.model,
        statusCode: normalizedError.status,
        errorCode: normalizedError.code,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs,
        upstreamStatusCode: null,
        upstreamStatus: 'failed'
      });
      throw error;
    }

    if (!upstreamResponse.ok) {
      const upstreamError = await this.createUpstreamError(upstreamResponse);
      await this.billingService.recordFailedChat({
        requestId: input.requestId,
        principal: billingPrincipal,
        model: allowedModel,
        upstream: billingTarget,
        errorCode: upstreamError.code
      });
      await this.recordRequestLogSafe({
        requestId: input.requestId,
        userId: auth.user.id,
        tokenId: auth.token.id,
        upstreamProviderId: mapping.provider.id,
        method: 'POST',
        path: '/v1/chat/completions',
        model: body.model,
        statusCode: upstreamError.status,
        errorCode: upstreamError.code,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs,
        upstreamStatusCode: upstreamResponse.status,
        upstreamStatus: 'http_error'
      });
      throw upstreamError;
    }

    let upstreamBodyJson: unknown;
    try {
      upstreamBodyJson = await this.readUpstreamJson(upstreamResponse);
    } catch (error) {
      await this.billingService.recordFailedChat({
        requestId: input.requestId,
        principal: billingPrincipal,
        model: allowedModel,
        upstream: billingTarget,
        errorCode: this.normalizeError(error).code
      });
      const normalizedError = this.normalizeError(error);
      await this.recordRequestLogSafe({
        requestId: input.requestId,
        userId: auth.user.id,
        tokenId: auth.token.id,
        upstreamProviderId: mapping.provider.id,
        method: 'POST',
        path: '/v1/chat/completions',
        model: body.model,
        statusCode: normalizedError.status,
        errorCode: normalizedError.code,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs,
        upstreamStatusCode: upstreamResponse.status,
        upstreamStatus: 'malformed_response'
      });
      throw error;
    }

    const billingRecord = await this.billingService.recordCompletedChat({
      requestId: input.requestId,
      principal: billingPrincipal,
      model: allowedModel,
      upstream: billingTarget,
      responseBody: upstreamBodyJson
    });
    await this.recordRequestLogSafe({
      requestId: input.requestId,
      userId: auth.user.id,
      tokenId: auth.token.id,
      upstreamProviderId: mapping.provider.id,
      method: 'POST',
      path: '/v1/chat/completions',
      model: body.model,
      statusCode: upstreamResponse.status,
      errorCode: null,
      latencyMs: Date.now() - startedAt,
      upstreamLatencyMs,
      upstreamStatusCode: upstreamResponse.status,
      upstreamStatus: 'success'
    });

    return {
      stream: false,
      status: upstreamResponse.status,
      headers: this.buildJsonHeaders(input.requestId, upstreamResponse, billingRecord.usageEventId),
      body: upstreamBodyJson
    };
    } catch (error) {
      const normalizedError = this.normalizeError(error);
      await this.recordRequestLogIfAbsentSafe({
        requestId: input.requestId,
        userId,
        tokenId,
        upstreamProviderId,
        method: 'POST',
        path: '/v1/chat/completions',
        model,
        statusCode: normalizedError.status,
        errorCode: normalizedError.code,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs: null,
        upstreamStatusCode: null,
        upstreamStatus: 'rejected'
      });
      throw error;
    }
  }

  async pipeUpstreamStream(upstreamResponse: Response, response: ServerResponse) {
    if (!upstreamResponse.body) {
      response.end();
      return;
    }

    const reader = upstreamResponse.body.getReader();
    let clientClosed = false;
    const onClientClose = () => {
      clientClosed = true;
      reader.cancel().catch(() => undefined);
    };
    response.once('close', onClientClose);

    try {
      while (true) {
        if (clientClosed || response.destroyed) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const canContinue = response.write(Buffer.from(value));
        if (!canContinue && !clientClosed && !response.destroyed) {
          await Promise.race([once(response, 'drain'), once(response, 'close')]).catch(() => undefined);
        }
      }
    } finally {
      response.off('close', onClientClose);
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
      reader.releaseLock();
    }
  }

  private async fetchUpstreamChatCompletionWithRetry(baseUrl: string, apiKey: string, body: ChatCompletionBody) {
    let response: Response;

    try {
      response = await this.fetchUpstreamChatCompletion(baseUrl, apiKey, body, { stream: false });
    } catch (error) {
      if (this.isRetryableUpstreamError(error)) {
        return this.fetchUpstreamChatCompletion(baseUrl, apiKey, body, { stream: false });
      }

      throw error;
    }

    if (RETRYABLE_UPSTREAM_STATUS.has(response.status)) {
      response = await this.fetchUpstreamChatCompletion(baseUrl, apiKey, body, { stream: false });
    }

    return response;
  }

  private async fetchUpstreamChatCompletion(
    baseUrl: string,
    apiKey: string,
    body: ChatCompletionBody,
    options: { stream: boolean; acceptHeader?: string }
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      return await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: options.stream ? 'text/event-stream' : (options.acceptHeader ?? 'application/json'),
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      throw this.createError(502, 'upstream_error', 'upstream_error', 'Upstream request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async findUpstreamMapping(publicModel: string, requiresStream: boolean) {
    const mapping = await this.prisma.upstreamModel.findFirst({
      where: {
        publicModel,
        status: ModelStatus.ACTIVE,
        supportsStream: requiresStream ? true : undefined,
        provider: {
          status: UpstreamProviderStatus.ACTIVE
        }
      },
      include: {
        provider: true
      },
      orderBy: { createdAt: 'asc' }
    });

    if (!mapping) {
      throw this.createError(
        400,
        'model_unavailable',
        'invalid_request_error',
        requiresStream ? 'Model is unavailable for streaming' : 'Model is unavailable'
      );
    }

    return mapping;
  }

  private normalizeChatCompletionBody(value: unknown): ChatCompletionBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'Request body must be a JSON object');
    }

    const body = value as Record<string, unknown>;
    if (typeof body.model !== 'string' || !body.model.trim()) {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'model is required');
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'messages must be a non-empty array');
    }

    if (body.stream !== undefined && typeof body.stream !== 'boolean') {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'stream must be a boolean');
    }

    return {
      ...body,
      model: body.model.trim(),
      messages: body.messages,
      stream: body.stream
    };
  }

  private async readUpstreamJson(response: Response) {
    const text = await response.text();
    if (!text) {
      throw this.createError(502, 'upstream_malformed_response', 'upstream_error', 'Upstream returned an empty response');
    }

    try {
      return JSON.parse(text);
    } catch {
      throw this.createError(502, 'upstream_malformed_response', 'upstream_error', 'Upstream returned malformed JSON');
    }
  }

  private async createUpstreamError(response: Response) {
    const upstreamBody = await response.text().catch(() => '');
    const status = response.status === 408 ? 408 : response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status;
    const code =
      status === 408 ? 'upstream_timeout' : status === 429 ? 'rate_limited' : status === 502 ? 'upstream_error' : 'upstream_error';
    const message = this.extractUpstreamErrorMessage(upstreamBody) ?? `Upstream request failed with HTTP ${response.status}`;
    return this.createError(status, code, 'upstream_error', message);
  }

  private extractUpstreamErrorMessage(body: string) {
    if (!body) {
      return null;
    }

    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown };
      if (typeof parsed.error?.message === 'string') {
        return parsed.error.message;
      }
      if (typeof parsed.message === 'string') {
        return parsed.message;
      }
    } catch {
      return null;
    }

    return null;
  }

  private buildJsonHeaders(requestId: string, response: Response, usageEventId?: string) {
    return {
      'content-type': response.headers.get('content-type') ?? 'application/json',
      'x-request-id': requestId,
      ...(usageEventId ? { 'x-usage-event-id': usageEventId } : {})
    };
  }

  private buildStreamHeaders(requestId: string, response: Response, usageEventId?: string) {
    return {
      'content-type': response.headers.get('content-type') ?? 'text/event-stream; charset=utf-8',
      'cache-control': response.headers.get('cache-control') ?? 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': requestId,
      ...(usageEventId ? { 'x-usage-event-id': usageEventId } : {})
    };
  }

  private normalizeExceptionMessage(error: ForbiddenException, fallback: string) {
    const response = error.getResponse();
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }

    return fallback;
  }

  private isRetryableUpstreamError(error: unknown) {
    return error instanceof RelayHttpError && error.status === 502 && error.code === 'upstream_error';
  }

  private async recordRequestLogSafe(input: RelayRequestLogInput) {
    await this.requestLogsService.recordRelayRequest(input).catch((error) => {
      console.warn('request_log_write_failed', error instanceof Error ? error.message : 'unknown error');
    });
  }

  private async recordRequestLogIfAbsentSafe(input: RelayRequestLogInput) {
    await this.requestLogsService.recordRelayRequestIfAbsent(input).catch((error) => {
      console.warn('request_log_write_failed', error instanceof Error ? error.message : 'unknown error');
    });
  }
}
