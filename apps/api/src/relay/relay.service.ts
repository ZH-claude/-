import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { decryptUpstreamApiKey } from '../admin/upstream-key-crypto';
import {
  BillingService,
  type BillableModel,
  type BillingPrincipal,
  type UpstreamBillingTarget
} from '../billing/billing.service';
import { estimateChatCompletionCostCents } from '../billing/balance-guard';
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
  billing?: StreamBillingContext;
};

type ChatCompletionInput = {
  apiKey: string;
  body: unknown;
  requestId: string;
  clientIp: string | null;
  acceptHeader?: string;
  logPath?: string;
};

type ChatCompletionBody = {
  model: string;
  messages: unknown[];
  stream?: boolean;
  [key: string]: unknown;
};

type AnthropicMessagesInput = {
  apiKey: string;
  body: unknown;
  requestId: string;
  clientIp: string | null;
  acceptHeader?: string;
};

type AnthropicMessagesBody = {
  model: string;
  messages: Array<Record<string, unknown>>;
  maxTokens: number;
  stream?: boolean;
  system?: unknown;
  tools?: unknown[];
  toolChoice?: unknown;
  temperature?: unknown;
  topP?: unknown;
  stopSequences?: unknown;
};

type OpenAiResponsesInput = {
  apiKey: string;
  body: unknown;
  requestId: string;
  clientIp: string | null;
  acceptHeader?: string;
};

type OpenAiResponsesBody = {
  model: string;
  input: unknown;
  instructions?: unknown;
  stream?: boolean;
  maxOutputTokens?: unknown;
  tools?: unknown[];
  temperature?: unknown;
  topP?: unknown;
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

type StreamBillingContext = {
  requestId: string;
  principal: BillingPrincipal;
  model: BillableModel;
  upstream: UpstreamBillingTarget;
};

type UpstreamMappingCandidate = {
  id: string;
  publicModel: string;
  upstreamModel: string;
  priority: number;
  timeoutMs: number;
  upstreamPrompt: string | null;
  inputPriceCentsPer1k: number | null;
  outputPriceCentsPer1k: number | null;
  modelMultiplier: { toString(): string } | null;
  provider: {
    id: string;
    baseUrl: string;
    encryptedApiKey: string;
  };
};

type UpstreamAttemptResult = {
  mapping: UpstreamMappingCandidate;
  response: Response;
  latencyMs: number;
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

class UpstreamAttemptFailureError extends Error {
  constructor(
    readonly causeError: unknown,
    readonly mapping: UpstreamMappingCandidate,
    readonly latencyMs: number | null,
    readonly upstreamStatusCode: number | null,
    readonly upstreamStatus: string
  ) {
    super(causeError instanceof Error ? causeError.message : 'Upstream request failed');
  }
}

const UPSTREAM_TIMEOUT_MS = 120_000;
const DEFAULT_FAILOVER_TIMEOUT_MS = 5000;
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

    if (this.isAbortLikeError(error)) {
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

      const data = auth.allowedModels.map((model) => ({
        id: model.model,
        object: 'model',
        owned_by: 'nested-relay',
        type: 'model',
        display_name: model.model,
        created_at: new Date().toISOString()
      }));

      return {
        object: 'list',
        data,
        has_more: false,
        first_id: data[0]?.id ?? null,
        last_id: data.at(-1)?.id ?? null,
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

  async listAnthropicModels(apiKey: string, requestId: string, clientIp: string | null) {
    const models = await this.listModels(apiKey, requestId, clientIp);
    const now = new Date().toISOString();

    return {
      data: models.data.map((model) => ({
        type: 'model',
        id: model.id,
        display_name: model.id,
        created_at: now
      })),
      has_more: false,
      first_id: models.data[0]?.id ?? null,
      last_id: models.data.at(-1)?.id ?? null,
      request_id: requestId
    };
  }

  async countAnthropicMessageTokens(input: AnthropicMessagesInput) {
    const startedAt = Date.now();
    let userId: string | null = null;
    let tokenId: string | null = null;
    let model: string | null = null;

    try {
      const auth = await this.tokensService.verifyApiToken(input.apiKey);
      userId = auth.user.id;
      tokenId = auth.token.id;
      const body = this.normalizeAnthropicMessagesBody(input.body, { requireMaxTokens: false });
      model = body.model;
      const allowedModel = auth.allowedModels.find((entry) => entry.model === body.model);
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
      await this.tokensService.activateApiTokenIfNeeded(auth.token);
      await this.recordRequestLogSafe({
        requestId: input.requestId,
        userId,
        tokenId,
        method: 'POST',
        path: '/v1/messages/count_tokens',
        model: body.model,
        statusCode: 200,
        errorCode: null,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs: null,
        upstreamStatusCode: null,
        upstreamStatus: 'not_required'
      });

      return {
        input_tokens: this.estimateAnthropicInputTokens(body),
        request_id: input.requestId
      };
    } catch (error) {
      const normalizedError = this.normalizeError(error);
      await this.recordRequestLogIfAbsentSafe({
        requestId: input.requestId,
        userId,
        tokenId,
        method: 'POST',
        path: '/v1/messages/count_tokens',
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

  async createAnthropicMessage(input: AnthropicMessagesInput): Promise<RelayJsonResult | RelayStreamResult> {
    const body = this.normalizeAnthropicMessagesBody(input.body);
    const openAiBody = this.toOpenAiChatCompletionBody(body);
    const result = await this.createChatCompletion({
      apiKey: input.apiKey,
      body: openAiBody,
      requestId: input.requestId,
      clientIp: input.clientIp,
      acceptHeader: input.acceptHeader,
      logPath: '/v1/messages'
    });

    if (result.stream) {
      return {
        ...result,
        headers: this.buildAnthropicStreamHeaders(input.requestId, result.headers)
      };
    }

    return {
      ...result,
      headers: this.buildAnthropicJsonHeaders(input.requestId, result.headers['x-usage-event-id']),
      body: this.toAnthropicMessageResponse(result.body, body.model, input.requestId)
    };
  }

  async createOpenAiResponse(input: OpenAiResponsesInput): Promise<RelayJsonResult> {
    const body = this.normalizeOpenAiResponsesBody(input.body);
    const chatBody = this.toOpenAiChatCompletionBodyFromResponse(body);
    const result = await this.createChatCompletion({
      apiKey: input.apiKey,
      body: chatBody,
      requestId: input.requestId,
      clientIp: input.clientIp,
      acceptHeader: input.acceptHeader,
      logPath: '/v1/responses'
    });

    if (result.stream) {
      throw this.createError(500, 'internal_error', 'server_error', 'Internal server error');
    }

    return {
      stream: false,
      status: result.status,
      headers: this.buildOpenAiResponsesHeaders(input.requestId, result.headers['x-usage-event-id']),
      body: this.toOpenAiResponseObject(result.body, body.model, input.requestId)
    };
  }

  async createChatCompletion(input: ChatCompletionInput): Promise<RelayJsonResult | RelayStreamResult> {
    const startedAt = Date.now();
    const requestPath = input.logPath ?? '/v1/chat/completions';
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

      const mappings = await this.findUpstreamMappings(body.model, Boolean(body.stream));
      const billingPrincipal = {
        userId: auth.user.id,
        tokenId: auth.token.id
      };
      const billingStartGuard = this.buildBillingStartGuard(body, allowedModel, mappings);
      await this.billingService.assertCanStartUsage(auth.user.id, billingStartGuard.model, billingStartGuard.estimatedCostCents);
      await this.tokensService.activateApiTokenIfNeeded(auth.token);

      if (body.stream) {
        let attempt: UpstreamAttemptResult;

        try {
          attempt = await this.fetchFirstAvailableUpstream({
            mappings,
            body,
            stream: true,
            acceptHeader: input.acceptHeader
          });
        } catch (error) {
          const failure = this.unwrapUpstreamAttemptFailure(error);
          const normalizedError = this.normalizeError(failure.causeError);
          upstreamProviderId = failure.mapping.provider.id;
          const billingTarget = {
            providerId: failure.mapping.provider.id,
            upstreamModel: failure.mapping.upstreamModel
          };
          await this.billingService.recordFailedChat({
            requestId: input.requestId,
            principal: billingPrincipal,
            model: this.buildBillableModelForRoute(allowedModel, failure.mapping),
            upstream: billingTarget,
            errorCode: normalizedError.code
          });
          await this.recordRequestLogSafe({
            requestId: input.requestId,
            userId: auth.user.id,
            tokenId: auth.token.id,
            upstreamProviderId: failure.mapping.provider.id,
            method: 'POST',
            path: requestPath,
            model: body.model,
            statusCode: normalizedError.status,
            errorCode: normalizedError.code,
            latencyMs: Date.now() - startedAt,
            upstreamLatencyMs: failure.latencyMs,
            upstreamStatusCode: failure.upstreamStatusCode,
            upstreamStatus: failure.upstreamStatus
          });
          throw failure.causeError;
        }

        upstreamProviderId = attempt.mapping.provider.id;
        const billingTarget = {
          providerId: attempt.mapping.provider.id,
          upstreamModel: attempt.mapping.upstreamModel
        };
        await this.recordRequestLogSafe({
          requestId: input.requestId,
          userId: auth.user.id,
          tokenId: auth.token.id,
          upstreamProviderId: attempt.mapping.provider.id,
          method: 'POST',
          path: requestPath,
          model: body.model,
          statusCode: attempt.response.status,
          errorCode: null,
          latencyMs: Date.now() - startedAt,
          upstreamLatencyMs: attempt.latencyMs,
          upstreamStatusCode: attempt.response.status,
          upstreamStatus: 'stream_started'
        });

        return {
          stream: true,
          status: attempt.response.status,
          headers: this.buildStreamHeaders(input.requestId, attempt.response),
          upstreamResponse: attempt.response,
          billing: {
            requestId: input.requestId,
            principal: billingPrincipal,
            model: this.buildBillableModelForRoute(allowedModel, attempt.mapping),
            upstream: billingTarget
          }
        };
      }

      let attempt: UpstreamAttemptResult;

      try {
        attempt = await this.fetchFirstAvailableUpstream({
          mappings,
          body,
          stream: false
        });
      } catch (error) {
        const failure = this.unwrapUpstreamAttemptFailure(error);
        const normalizedError = this.normalizeError(failure.causeError);
        upstreamProviderId = failure.mapping.provider.id;
        const billingTarget = {
          providerId: failure.mapping.provider.id,
          upstreamModel: failure.mapping.upstreamModel
        };
        await this.billingService.recordFailedChat({
          requestId: input.requestId,
          principal: billingPrincipal,
          model: this.buildBillableModelForRoute(allowedModel, failure.mapping),
          upstream: billingTarget,
          errorCode: normalizedError.code
        });
        await this.recordRequestLogSafe({
          requestId: input.requestId,
          userId: auth.user.id,
          tokenId: auth.token.id,
          upstreamProviderId: failure.mapping.provider.id,
          method: 'POST',
          path: requestPath,
          model: body.model,
          statusCode: normalizedError.status,
          errorCode: normalizedError.code,
          latencyMs: Date.now() - startedAt,
          upstreamLatencyMs: failure.latencyMs,
          upstreamStatusCode: failure.upstreamStatusCode,
          upstreamStatus: failure.upstreamStatus
        });
        throw failure.causeError;
      }

      upstreamProviderId = attempt.mapping.provider.id;
      const billingTarget = {
        providerId: attempt.mapping.provider.id,
        upstreamModel: attempt.mapping.upstreamModel
      };
      let upstreamBodyJson: unknown;
      try {
        upstreamBodyJson = await this.readUpstreamJson(attempt.response);
      } catch (error) {
        await this.billingService.recordFailedChat({
          requestId: input.requestId,
          principal: billingPrincipal,
          model: this.buildBillableModelForRoute(allowedModel, attempt.mapping),
          upstream: billingTarget,
          errorCode: this.normalizeError(error).code
        });
        const normalizedError = this.normalizeError(error);
        await this.recordRequestLogSafe({
          requestId: input.requestId,
          userId: auth.user.id,
          tokenId: auth.token.id,
          upstreamProviderId: attempt.mapping.provider.id,
          method: 'POST',
          path: requestPath,
          model: body.model,
          statusCode: normalizedError.status,
          errorCode: normalizedError.code,
          latencyMs: Date.now() - startedAt,
          upstreamLatencyMs: attempt.latencyMs,
          upstreamStatusCode: attempt.response.status,
          upstreamStatus: 'malformed_response'
        });
        throw error;
      }

      const billingRecord = await this.billingService.recordCompletedChat({
        requestId: input.requestId,
        principal: billingPrincipal,
        model: this.buildBillableModelForRoute(allowedModel, attempt.mapping),
        upstream: billingTarget,
        responseBody: upstreamBodyJson
      });
      await this.recordRequestLogSafe({
        requestId: input.requestId,
        userId: auth.user.id,
        tokenId: auth.token.id,
        upstreamProviderId: attempt.mapping.provider.id,
        method: 'POST',
        path: requestPath,
        model: body.model,
        statusCode: attempt.response.status,
        errorCode: null,
        latencyMs: Date.now() - startedAt,
        upstreamLatencyMs: attempt.latencyMs,
        upstreamStatusCode: attempt.response.status,
        upstreamStatus: 'success'
      });

      return {
        stream: false,
        status: attempt.response.status,
        headers: this.buildJsonHeaders(input.requestId, attempt.response, billingRecord.usageEventId),
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
        path: requestPath,
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

  async pipeUpstreamStream(
    upstreamResponse: Response,
    response: ServerResponse,
    billing?: StreamBillingContext
  ) {
    if (!upstreamResponse.body) {
      await this.recordStreamBilling(billing, null);
      response.end();
      return;
    }

    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    let clientClosed = false;
    let buffer = '';
    let finalUsage: Record<string, unknown> | null = null;
    const onClientClose = () => {
      clientClosed = true;
      reader.cancel().catch(() => undefined);
    };
    response.once('close', onClientClose);

    const processOpenAiEvent = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '[DONE]') {
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      const usage = parsed.usage;
      if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
        finalUsage = usage as Record<string, unknown>;
      }
    };

    try {
      while (true) {
        if (clientClosed || response.destroyed) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const dataLines = chunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          for (const dataLine of dataLines) {
            processOpenAiEvent(dataLine);
          }
        }

        const canContinue = response.write(Buffer.from(value));
        if (!canContinue && !clientClosed && !response.destroyed) {
          await Promise.race([once(response, 'drain'), once(response, 'close')]).catch(() => undefined);
        }
      }

      if (buffer.trim()) {
        const dataLines = buffer
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());
        for (const dataLine of dataLines) {
          processOpenAiEvent(dataLine);
        }
      }
    } finally {
      response.off('close', onClientClose);
      reader.releaseLock();
      await this.recordStreamBilling(billing, finalUsage);
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    }
  }

  async pipeOpenAiStreamAsAnthropic(
    upstreamResponse: Response,
    response: ServerResponse,
    input: { requestId: string; model: string | null; billing?: StreamBillingContext }
  ) {
    if (!upstreamResponse.body) {
      await this.recordStreamBilling(input.billing, null);
      response.end();
      return;
    }

    const decoder = new TextDecoder();
    const reader = upstreamResponse.body.getReader();
    let clientClosed = false;
    let buffer = '';
    let messageId = `msg_${input.requestId.replace(/^req_/, '')}`;
    let textBlockIndex: number | null = null;
    let nextBlockIndex = 0;
    let finalFinishReason: string | null = null;
    let outputTokens = 0;
    let finalUsage: Record<string, unknown> | null = null;
    const openToolBlocks = new Map<number, { index: number; id: string; name: string }>();

    const onClientClose = () => {
      clientClosed = true;
      reader.cancel().catch(() => undefined);
    };
    response.once('close', onClientClose);

    const writeEvent = (event: string, data: unknown) => {
      if (!clientClosed && !response.destroyed) {
        response.write(`event: ${event}\n`);
        response.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    writeEvent('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: input.model ?? 'unknown',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0
        }
      }
    });

    const processOpenAiEvent = (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || trimmed === '[DONE]') {
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }

      if (typeof parsed.id === 'string') {
        messageId = `msg_${parsed.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
      }

      const usage = parsed.usage;
      if (usage && typeof usage === 'object' && !Array.isArray(usage)) {
        const usageRecord = usage as Record<string, unknown>;
        finalUsage = usageRecord;
        if (Number.isInteger(usageRecord.completion_tokens)) {
          outputTokens = Number(usageRecord.completion_tokens);
        } else if (Number.isInteger(usageRecord.output_tokens)) {
          outputTokens = Number(usageRecord.output_tokens);
        }
      }

      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const firstChoice = choices[0];
      if (!firstChoice || typeof firstChoice !== 'object' || Array.isArray(firstChoice)) {
        return;
      }

      const choice = firstChoice as Record<string, unknown>;
      if (typeof choice.finish_reason === 'string') {
        finalFinishReason = choice.finish_reason;
      }

      const delta = choice.delta;
      if (!delta || typeof delta !== 'object' || Array.isArray(delta)) {
        return;
      }

      const deltaRecord = delta as Record<string, unknown>;
      if (typeof deltaRecord.content === 'string' && deltaRecord.content.length > 0) {
        if (textBlockIndex === null) {
          textBlockIndex = nextBlockIndex;
          nextBlockIndex += 1;
          writeEvent('content_block_start', {
            type: 'content_block_start',
            index: textBlockIndex,
            content_block: {
              type: 'text',
              text: ''
            }
          });
        }
        writeEvent('content_block_delta', {
          type: 'content_block_delta',
          index: textBlockIndex,
          delta: {
            type: 'text_delta',
            text: deltaRecord.content
          }
        });
      }

      if (Array.isArray(deltaRecord.tool_calls)) {
        for (const rawToolCall of deltaRecord.tool_calls) {
          if (!rawToolCall || typeof rawToolCall !== 'object' || Array.isArray(rawToolCall)) {
            continue;
          }

          const toolCall = rawToolCall as Record<string, unknown>;
          const toolCallPosition = Number.isInteger(toolCall.index) ? Number(toolCall.index) : openToolBlocks.size;
          const functionValue = toolCall.function;
          const functionRecord =
            functionValue && typeof functionValue === 'object' && !Array.isArray(functionValue)
              ? (functionValue as Record<string, unknown>)
              : {};
          const existing = openToolBlocks.get(toolCallPosition);
          const id = typeof toolCall.id === 'string' ? toolCall.id : existing?.id ?? `toolu_${input.requestId}_${toolCallPosition}`;
          const name = typeof functionRecord.name === 'string' ? functionRecord.name : existing?.name ?? 'tool';

          if (!existing) {
            const block = { index: nextBlockIndex, id, name };
            openToolBlocks.set(toolCallPosition, block);
            nextBlockIndex += 1;
            writeEvent('content_block_start', {
              type: 'content_block_start',
              index: block.index,
              content_block: {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: {}
              }
            });
          }

          const block = openToolBlocks.get(toolCallPosition);
          if (block && typeof functionRecord.arguments === 'string' && functionRecord.arguments.length > 0) {
            writeEvent('content_block_delta', {
              type: 'content_block_delta',
              index: block.index,
              delta: {
                type: 'input_json_delta',
                partial_json: functionRecord.arguments
              }
            });
          }
        }
      }
    };

    try {
      while (true) {
        if (clientClosed || response.destroyed) {
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const dataLines = chunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          for (const dataLine of dataLines) {
            processOpenAiEvent(dataLine);
          }
        }
      }

      if (buffer.trim()) {
        const dataLines = buffer
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim());
        for (const dataLine of dataLines) {
          processOpenAiEvent(dataLine);
        }
      }

      if (textBlockIndex !== null) {
        writeEvent('content_block_stop', {
          type: 'content_block_stop',
          index: textBlockIndex
        });
      }

      for (const block of openToolBlocks.values()) {
        writeEvent('content_block_stop', {
          type: 'content_block_stop',
          index: block.index
        });
      }

      writeEvent('message_delta', {
        type: 'message_delta',
        delta: {
          stop_reason: this.mapOpenAiFinishReasonToAnthropic(finalFinishReason),
          stop_sequence: null
        },
        usage: {
          output_tokens: outputTokens
        }
      });
      writeEvent('message_stop', { type: 'message_stop' });
    } finally {
      response.off('close', onClientClose);
      reader.releaseLock();
      await this.recordStreamBilling(input.billing, finalUsage);
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    }
  }

  writeOpenAiResponseAsEventStream(responseBody: unknown, response: ServerResponse) {
    const responseRecord =
      responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
        ? (responseBody as Record<string, unknown>)
        : {};
    const responseId = typeof responseRecord.id === 'string' ? responseRecord.id : `resp_${randomUUID().replace(/-/g, '')}`;
    const output = Array.isArray(responseRecord.output) ? responseRecord.output : [];
    let sequenceNumber = 1;

    const writeEvent = (event: string, data: unknown) => {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify({
        ...(data && typeof data === 'object' && !Array.isArray(data) ? data : { data }),
        sequence_number: sequenceNumber
      })}\n\n`);
      sequenceNumber += 1;
    };

    const created = {
      ...responseRecord,
      status: 'in_progress',
      output: []
    };
    writeEvent('response.created', {
      type: 'response.created',
      response: created
    });

    output.forEach((rawOutputItem, outputIndex) => {
      if (!rawOutputItem || typeof rawOutputItem !== 'object' || Array.isArray(rawOutputItem)) {
        return;
      }

      const outputItem = rawOutputItem as Record<string, unknown>;
      const itemId = typeof outputItem.id === 'string' ? outputItem.id : `item_${outputIndex}`;
      writeEvent('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: outputIndex,
        item: outputItem.type === 'message'
          ? {
            ...outputItem,
            status: 'in_progress',
            content: []
          }
          : {
            ...outputItem,
            status: 'in_progress'
          }
      });

      const content = Array.isArray(outputItem.content) ? outputItem.content : [];
      content.forEach((rawPart, contentIndex) => {
        if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) {
          return;
        }

        const part = rawPart as Record<string, unknown>;
        writeEvent('response.content_part.added', {
          type: 'response.content_part.added',
          item_id: itemId,
          output_index: outputIndex,
          content_index: contentIndex,
          part: {
            ...part,
            text: '',
            annotations: Array.isArray(part.annotations) ? part.annotations : []
          }
        });

        const text = typeof part.text === 'string' ? part.text : '';
        if (text) {
          writeEvent('response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: itemId,
            output_index: outputIndex,
            content_index: contentIndex,
            delta: text
          });
        }

        writeEvent('response.output_text.done', {
          type: 'response.output_text.done',
          item_id: itemId,
          output_index: outputIndex,
          content_index: contentIndex,
          text
        });
        writeEvent('response.content_part.done', {
          type: 'response.content_part.done',
          item_id: itemId,
          output_index: outputIndex,
          content_index: contentIndex,
          part
        });
      });

      if (outputItem.type === 'function_call') {
        const argumentsText = typeof outputItem.arguments === 'string' ? outputItem.arguments : '{}';
        const name = typeof outputItem.name === 'string' ? outputItem.name : 'tool';
        if (argumentsText.length > 0) {
          writeEvent('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: itemId,
            output_index: outputIndex,
            delta: argumentsText
          });
        }
        writeEvent('response.function_call_arguments.done', {
          type: 'response.function_call_arguments.done',
          item_id: itemId,
          output_index: outputIndex,
          name,
          arguments: argumentsText
        });
      }

      writeEvent('response.output_item.done', {
        type: 'response.output_item.done',
        output_index: outputIndex,
        item: outputItem
      });
    });

    writeEvent('response.completed', {
      type: 'response.completed',
      response: {
        ...responseRecord,
        id: responseId,
        status: 'completed'
      }
    });
    response.end();
  }

  private async fetchFirstAvailableUpstream(input: {
    mappings: UpstreamMappingCandidate[];
    body: ChatCompletionBody;
    stream: boolean;
    acceptHeader?: string;
  }): Promise<UpstreamAttemptResult> {
    let lastFailure: UpstreamAttemptFailureError | null = null;

    for (const mapping of input.mappings) {
      const upstreamBody = this.buildUpstreamBody(input.body, mapping);
      const body = input.stream ? this.withStreamUsageOptions(upstreamBody) : upstreamBody;
      const upstreamStartedAt = Date.now();

      try {
        const response = await this.fetchUpstreamChatCompletion(
          mapping.provider.baseUrl,
          decryptUpstreamApiKey(mapping.provider.encryptedApiKey),
          body,
          {
            stream: input.stream,
            acceptHeader: input.acceptHeader,
            timeoutMs: this.normalizeUpstreamTimeoutMs(mapping.timeoutMs)
          }
        );
        const latencyMs = Date.now() - upstreamStartedAt;

        if (response.ok) {
          return {
            mapping,
            response,
            latencyMs
          };
        }

        const upstreamError = await this.createUpstreamError(response);
        const failure = new UpstreamAttemptFailureError(upstreamError, mapping, latencyMs, response.status, 'http_error');
        lastFailure = failure;
        if (!this.shouldFailoverUpstreamStatus(response.status)) {
          throw failure;
        }
      } catch (error) {
        if (error instanceof UpstreamAttemptFailureError) {
          lastFailure = error;
          if (!this.shouldFailoverError(error.causeError)) {
            throw error;
          }
          continue;
        }

        const failure = new UpstreamAttemptFailureError(error, mapping, Date.now() - upstreamStartedAt, null, 'failed');
        lastFailure = failure;
        if (!this.shouldFailoverError(error)) {
          throw failure;
        }
        continue;
      }
    }

    if (lastFailure) {
      throw lastFailure;
    }

    const firstMapping = input.mappings[0];
    if (!firstMapping) {
      throw this.createError(400, 'model_unavailable', 'invalid_request_error', 'Model is unavailable');
    }

    throw new UpstreamAttemptFailureError(
      this.createError(400, 'model_unavailable', 'invalid_request_error', 'Model is unavailable'),
      firstMapping,
      null,
      null,
      'failed'
    );
  }

  private buildUpstreamBody(body: ChatCompletionBody, mapping: UpstreamMappingCandidate): ChatCompletionBody {
    const upstreamBody: ChatCompletionBody = {
      ...body,
      model: mapping.upstreamModel,
      messages: [...body.messages]
    };
    const upstreamPrompt = mapping.upstreamPrompt?.trim();

    if (!upstreamPrompt) {
      return upstreamBody;
    }

    return {
      ...upstreamBody,
      messages: this.injectUpstreamPrompt(upstreamBody.messages, upstreamPrompt)
    };
  }

  private buildBillableModelForRoute(defaultModel: BillableModel, mapping: UpstreamMappingCandidate | undefined): BillableModel {
    if (
      !mapping ||
      mapping.inputPriceCentsPer1k === null ||
      mapping.outputPriceCentsPer1k === null ||
      mapping.modelMultiplier === null
    ) {
      return defaultModel;
    }

    return {
      ...defaultModel,
      inputPriceCentsPer1k: mapping.inputPriceCentsPer1k,
      outputPriceCentsPer1k: mapping.outputPriceCentsPer1k,
      modelMultiplier: mapping.modelMultiplier.toString()
    };
  }

  private buildBillingStartGuard(
    body: ChatCompletionBody,
    defaultModel: BillableModel,
    mappings: UpstreamMappingCandidate[]
  ) {
    let guardModel = this.buildBillableModelForRoute(defaultModel, mappings[0]);
    let estimatedCostCents = 1;

    for (const mapping of mappings) {
      const routeModel = this.buildBillableModelForRoute(defaultModel, mapping);
      const routeBody = this.buildUpstreamBody(body, mapping);
      const routeCostCents = estimateChatCompletionCostCents(routeBody, routeModel);
      if (routeCostCents > estimatedCostCents) {
        estimatedCostCents = routeCostCents;
        guardModel = routeModel;
      }
    }

    return { model: guardModel, estimatedCostCents };
  }

  private injectUpstreamPrompt(messages: unknown[], upstreamPrompt: string): unknown[] {
    const [firstMessage, ...restMessages] = messages;
    if (
      firstMessage &&
      typeof firstMessage === 'object' &&
      !Array.isArray(firstMessage) &&
      ((firstMessage as Record<string, unknown>).role === 'system' || (firstMessage as Record<string, unknown>).role === 'developer') &&
      typeof (firstMessage as Record<string, unknown>).content === 'string'
    ) {
      return [
        {
          ...firstMessage,
          role: 'system',
          content: `${upstreamPrompt}\n\n${(firstMessage as Record<string, string>).content}`
        },
        ...restMessages
      ];
    }

    return [{ role: 'system', content: upstreamPrompt }, ...messages];
  }

  private unwrapUpstreamAttemptFailure(error: unknown) {
    if (error instanceof UpstreamAttemptFailureError) {
      return error;
    }

    throw error;
  }

  private shouldFailoverUpstreamStatus(status: number) {
    return RETRYABLE_UPSTREAM_STATUS.has(status) || status === 408;
  }

  private shouldFailoverError(error: unknown) {
    if (error instanceof RelayHttpError) {
      return error.code === 'upstream_error' || error.code === 'upstream_timeout' || this.shouldFailoverUpstreamStatus(error.status);
    }

    return this.isAbortLikeError(error);
  }

  private isAbortLikeError(error: unknown) {
    return typeof error === 'object'
      && error !== null
      && 'name' in error
      && String((error as { name?: unknown }).name) === 'AbortError';
  }

  private normalizeUpstreamTimeoutMs(timeoutMs: number) {
    return Number.isInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30000
      ? timeoutMs
      : DEFAULT_FAILOVER_TIMEOUT_MS;
  }

  private normalizeAnthropicMessagesBody(
    value: unknown,
    options: { requireMaxTokens?: boolean } = {}
  ): AnthropicMessagesBody {
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

    const messages = body.messages.map((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw this.createError(400, 'bad_request', 'invalid_request_error', 'messages contains invalid item');
      }
      const messageRecord = message as Record<string, unknown>;
      if (
        messageRecord.role !== 'user' &&
        messageRecord.role !== 'assistant' &&
        messageRecord.role !== 'system' &&
        messageRecord.role !== 'developer'
      ) {
        throw this.createError(400, 'bad_request', 'invalid_request_error', 'message role must be user, assistant, system, or developer');
      }
      return messageRecord;
    });

    const requireMaxTokens = options.requireMaxTokens ?? true;
    const maxTokens = Number(body.max_tokens);
    if (requireMaxTokens && (!Number.isInteger(maxTokens) || maxTokens <= 0)) {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'max_tokens is required');
    }

    if (body.stream !== undefined && typeof body.stream !== 'boolean') {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'stream must be a boolean');
    }

    return {
      model: body.model.trim(),
      messages,
      maxTokens: Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : 1,
      stream: body.stream,
      system: body.system,
      tools: Array.isArray(body.tools) ? body.tools : undefined,
      toolChoice: body.tool_choice,
      temperature: body.temperature,
      topP: body.top_p,
      stopSequences: body.stop_sequences
    };
  }

  private normalizeOpenAiResponsesBody(value: unknown): OpenAiResponsesBody {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'Request body must be a JSON object');
    }

    const body = value as Record<string, unknown>;
    if (typeof body.model !== 'string' || !body.model.trim()) {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'model is required');
    }

    if (body.input === undefined || body.input === null) {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'input is required');
    }

    if (body.stream !== undefined && typeof body.stream !== 'boolean') {
      throw this.createError(400, 'bad_request', 'invalid_request_error', 'stream must be a boolean');
    }

    return {
      model: body.model.trim(),
      input: body.input,
      instructions: body.instructions,
      stream: body.stream,
      maxOutputTokens: body.max_output_tokens,
      tools: Array.isArray(body.tools) ? body.tools : undefined,
      temperature: body.temperature,
      topP: body.top_p
    };
  }

  private toOpenAiChatCompletionBodyFromResponse(body: OpenAiResponsesBody): ChatCompletionBody {
    const messages: Array<Record<string, unknown>> = [];
    if (typeof body.instructions === 'string' && body.instructions.trim()) {
      messages.push({ role: 'system', content: body.instructions.trim() });
    }

    messages.push(...this.toChatMessagesFromResponseInput(body.input));

    const chatBody: ChatCompletionBody = {
      model: body.model,
      messages,
      stream: false
    };

    const maxTokens = typeof body.maxOutputTokens === 'number' ? body.maxOutputTokens : Number(body.maxOutputTokens);
    if (Number.isInteger(maxTokens) && maxTokens > 0) {
      chatBody.max_tokens = maxTokens;
    }
    if (body.temperature !== undefined) {
      chatBody.temperature = body.temperature;
    }
    if (body.topP !== undefined) {
      chatBody.top_p = body.topP;
    }

    const tools = this.toChatToolsFromResponsesTools(body.tools);
    if (tools.length > 0) {
      chatBody.tools = tools;
      chatBody.tool_choice = 'auto';
    }

    return chatBody;
  }

  private toChatMessagesFromResponseInput(input: unknown): Array<Record<string, unknown>> {
    if (typeof input === 'string') {
      return [{ role: 'user', content: input }];
    }

    if (!Array.isArray(input)) {
      return [{ role: 'user', content: this.extractResponseInputText(input) ?? '' }];
    }

    const messages: Array<Record<string, unknown>> = [];
    for (const item of input) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const record = item as Record<string, unknown>;
      if (record.type === 'message') {
        const role = this.toChatRole(record.role);
        messages.push({
          role,
          content: this.extractResponseInputText(record.content) ?? ''
        });
      } else if (record.type === 'function_call_output' && typeof record.call_id === 'string') {
        messages.push({
          role: 'tool',
          tool_call_id: record.call_id,
          content: this.extractResponseInputText(record.output) ?? ''
        });
      } else if (typeof record.role === 'string') {
        messages.push({
          role: this.toChatRole(record.role),
          content: this.extractResponseInputText(record.content ?? record.input) ?? ''
        });
      }
    }

    return messages.length > 0 ? messages : [{ role: 'user', content: '' }];
  }

  private toChatRole(role: unknown) {
    if (role === 'assistant') {
      return 'assistant';
    }
    if (role === 'system' || role === 'developer') {
      return 'system';
    }
    return 'user';
  }

  private extractResponseInputText(value: unknown): string | null {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      const parts = value
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry;
          }
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const record = entry as Record<string, unknown>;
            if (typeof record.text === 'string') {
              return record.text;
            }
            if (typeof record.output_text === 'string') {
              return record.output_text;
            }
            if (typeof record.input_text === 'string') {
              return record.input_text;
            }
            return this.extractResponseInputText(record.content);
          }
          return null;
        })
        .filter((entry): entry is string => Boolean(entry));
      return parts.length > 0 ? parts.join('\n') : null;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (typeof record.text === 'string') {
        return record.text;
      }
      if (typeof record.output === 'string') {
        return record.output;
      }
      if (typeof record.content === 'string') {
        return record.content;
      }
    }

    return null;
  }

  private toChatToolsFromResponsesTools(tools: unknown[] | undefined) {
    if (!tools) {
      return [];
    }

    return tools
      .map((tool) => {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
          return null;
        }
        const record = tool as Record<string, unknown>;
        if (record.type !== 'function' || typeof record.name !== 'string') {
          return null;
        }
        return {
          type: 'function',
          function: {
            name: record.name,
            description: typeof record.description === 'string' ? record.description : '',
            parameters:
              record.parameters && typeof record.parameters === 'object' && !Array.isArray(record.parameters)
                ? record.parameters
                : { type: 'object', properties: {} }
          }
        };
      })
      .filter((tool) => Boolean(tool));
  }

  private toOpenAiResponseObject(responseBody: unknown, model: string, requestId: string) {
    const responseRecord =
      responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
        ? (responseBody as Record<string, unknown>)
        : {};
    const choices = Array.isArray(responseRecord.choices) ? responseRecord.choices : [];
    const firstChoice = choices[0] && typeof choices[0] === 'object' && !Array.isArray(choices[0])
      ? (choices[0] as Record<string, unknown>)
      : {};
    const message = firstChoice.message && typeof firstChoice.message === 'object' && !Array.isArray(firstChoice.message)
      ? (firstChoice.message as Record<string, unknown>)
      : {};
    const usage = responseRecord.usage && typeof responseRecord.usage === 'object' && !Array.isArray(responseRecord.usage)
      ? (responseRecord.usage as Record<string, unknown>)
      : {};
    const responseId = `resp_${requestId.replace(/^req_/, '')}`;
    const output = this.toOpenAiResponseOutputItems(message, requestId);
    const inputTokens = this.nonNegativeNumber(usage.prompt_tokens ?? usage.input_tokens);
    const outputTokens = this.nonNegativeNumber(usage.completion_tokens ?? usage.output_tokens);

    return {
      id: responseId,
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      error: null,
      incomplete_details: null,
      instructions: null,
      max_output_tokens: null,
      model,
      output,
      output_text: output
        .flatMap((item) => Array.isArray(item.content) ? item.content : [])
        .map((part) => (part && typeof part === 'object' && !Array.isArray(part) && typeof part.text === 'string') ? part.text : '')
        .join(''),
      parallel_tool_calls: true,
      previous_response_id: null,
      store: false,
      temperature: null,
      tool_choice: 'auto',
      tools: [],
      top_p: null,
      truncation: 'disabled',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: this.nonNegativeNumber(usage.total_tokens) || inputTokens + outputTokens
      },
      user: null
    };
  }

  private toOpenAiResponseOutputItems(message: Record<string, unknown>, requestId: string) {
    const output: Array<Record<string, unknown>> = [];
    const text = typeof message.content === 'string' ? message.content : this.extractResponseInputText(message.content) ?? '';
    if (text) {
      output.push({
        id: `msg_${requestId.replace(/^req_/, '')}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
            annotations: []
          }
        ]
      });
    }

    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
          continue;
        }
        const toolRecord = toolCall as Record<string, unknown>;
        const functionValue = toolRecord.function;
        const functionRecord =
          functionValue && typeof functionValue === 'object' && !Array.isArray(functionValue)
            ? (functionValue as Record<string, unknown>)
            : {};
        output.push({
          id: typeof toolRecord.id === 'string' ? toolRecord.id : `fc_${output.length}`,
          type: 'function_call',
          status: 'completed',
          call_id: typeof toolRecord.id === 'string' ? toolRecord.id : `call_${output.length}`,
          name: typeof functionRecord.name === 'string' ? functionRecord.name : 'tool',
          arguments: typeof functionRecord.arguments === 'string' ? functionRecord.arguments : '{}'
        });
      }
    }

    return output.length > 0 ? output : [
      {
        id: `msg_${requestId.replace(/^req_/, '')}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: '', annotations: [] }]
      }
    ];
  }

  private toOpenAiChatCompletionBody(body: AnthropicMessagesBody): ChatCompletionBody {
    const messages = this.toOpenAiMessages(body);
    const chatBody: ChatCompletionBody = {
      model: body.model,
      messages,
      stream: body.stream,
      max_tokens: body.maxTokens
    };

    if (body.temperature !== undefined) {
      chatBody.temperature = body.temperature;
    }
    if (body.topP !== undefined) {
      chatBody.top_p = body.topP;
    }
    if (Array.isArray(body.stopSequences)) {
      chatBody.stop = body.stopSequences;
    }

    const tools = this.toOpenAiTools(body.tools);
    if (tools.length > 0) {
      chatBody.tools = tools;
      chatBody.tool_choice = this.toOpenAiToolChoice(body.toolChoice);
    }

    return chatBody;
  }

  private toOpenAiMessages(body: AnthropicMessagesBody) {
    const messages: Array<Record<string, unknown>> = [];
    const systemText = this.extractAnthropicContentText(body.system);
    if (systemText) {
      messages.push({ role: 'system', content: systemText });
    }

    for (const message of body.messages) {
      const role = message.role;
      if (role === 'user') {
        messages.push(...this.toOpenAiUserMessages(message.content));
      } else if (role === 'assistant') {
        messages.push(this.toOpenAiAssistantMessage(message.content));
      } else if (role === 'system' || role === 'developer') {
        const systemContent = this.extractAnthropicContentText(message.content);
        if (systemContent) {
          messages.push({ role: 'system', content: systemContent });
        }
      }
    }

    return messages;
  }

  private toOpenAiUserMessages(content: unknown): Array<Record<string, unknown>> {
    if (typeof content === 'string') {
      return [{ role: 'user', content }];
    }

    if (!Array.isArray(content)) {
      return [{ role: 'user', content: this.extractAnthropicContentText(content) ?? '' }];
    }

    const messages: Array<Record<string, unknown>> = [];
    const userParts: unknown[] = [];

    for (const block of content) {
      if (!block || typeof block !== 'object' || Array.isArray(block)) {
        continue;
      }

      const blockRecord = block as Record<string, unknown>;
      if (blockRecord.type === 'text' && typeof blockRecord.text === 'string') {
        userParts.push({ type: 'text', text: blockRecord.text });
      } else if (blockRecord.type === 'image') {
        const imagePart = this.toOpenAiImagePart(blockRecord.source);
        if (imagePart) {
          userParts.push(imagePart);
        }
      } else if (blockRecord.type === 'tool_result' && typeof blockRecord.tool_use_id === 'string') {
        if (userParts.length > 0) {
          messages.push({ role: 'user', content: this.toOpenAiUserContentFromParts(userParts) });
          userParts.length = 0;
        }
        messages.push({
          role: 'tool',
          tool_call_id: blockRecord.tool_use_id,
          content: this.extractAnthropicContentText(blockRecord.content) ?? ''
        });
      }
    }

    if (userParts.length > 0) {
      messages.push({
        role: 'user',
        content: this.toOpenAiUserContentFromParts(userParts)
      });
    }

    return messages.length > 0 ? messages : [{ role: 'user', content: '' }];
  }

  private toOpenAiUserContentFromParts(userParts: unknown[]) {
    const textOnly = userParts.every(
      (part) => part && typeof part === 'object' && !Array.isArray(part) && (part as Record<string, unknown>).type === 'text'
    );
    return textOnly
      ? userParts.map((part) => (part as { text: string }).text).join('\n')
      : userParts;
  }

  private toOpenAiAssistantMessage(content: unknown) {
    if (typeof content === 'string') {
      return { role: 'assistant', content };
    }

    const textParts: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object' || Array.isArray(block)) {
          continue;
        }

        const blockRecord = block as Record<string, unknown>;
        if (blockRecord.type === 'text' && typeof blockRecord.text === 'string') {
          textParts.push(blockRecord.text);
        } else if (blockRecord.type === 'tool_use' && typeof blockRecord.id === 'string' && typeof blockRecord.name === 'string') {
          toolCalls.push({
            id: blockRecord.id,
            type: 'function',
            function: {
              name: blockRecord.name,
              arguments: JSON.stringify(blockRecord.input ?? {})
            }
          });
        }
      }
    } else {
      const text = this.extractAnthropicContentText(content);
      if (text) {
        textParts.push(text);
      }
    }

    return {
      role: 'assistant',
      content: textParts.join('\n') || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
    };
  }

  private toOpenAiImagePart(source: unknown) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return null;
    }

    const sourceRecord = source as Record<string, unknown>;
    if (sourceRecord.type === 'base64' && typeof sourceRecord.media_type === 'string' && typeof sourceRecord.data === 'string') {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${sourceRecord.media_type};base64,${sourceRecord.data}`
        }
      };
    }

    if (sourceRecord.type === 'url' && typeof sourceRecord.url === 'string') {
      return {
        type: 'image_url',
        image_url: {
          url: sourceRecord.url
        }
      };
    }

    return null;
  }

  private toOpenAiTools(tools: unknown[] | undefined) {
    if (!tools) {
      return [];
    }

    return tools
      .map((tool) => {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
          return null;
        }
        const toolRecord = tool as Record<string, unknown>;
        if (typeof toolRecord.name !== 'string') {
          return null;
        }
        return {
          type: 'function',
          function: {
            name: toolRecord.name,
            description: typeof toolRecord.description === 'string' ? toolRecord.description : '',
            parameters:
              toolRecord.input_schema && typeof toolRecord.input_schema === 'object' && !Array.isArray(toolRecord.input_schema)
                ? toolRecord.input_schema
                : { type: 'object', properties: {} }
          }
        };
      })
      .filter((tool) => Boolean(tool));
  }

  private toOpenAiToolChoice(toolChoice: unknown) {
    if (!toolChoice || typeof toolChoice !== 'object' || Array.isArray(toolChoice)) {
      return 'auto';
    }

    const record = toolChoice as Record<string, unknown>;
    if (record.type === 'auto') {
      return 'auto';
    }
    if (record.type === 'any') {
      return 'required';
    }
    if (record.type === 'tool' && typeof record.name === 'string') {
      return {
        type: 'function',
        function: {
          name: record.name
        }
      };
    }

    return 'auto';
  }

  private toAnthropicMessageResponse(responseBody: unknown, model: string, requestId: string) {
    const responseRecord =
      responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)
        ? (responseBody as Record<string, unknown>)
        : {};
    const choices = Array.isArray(responseRecord.choices) ? responseRecord.choices : [];
    const firstChoice = choices[0] && typeof choices[0] === 'object' && !Array.isArray(choices[0])
      ? (choices[0] as Record<string, unknown>)
      : {};
    const message = firstChoice.message && typeof firstChoice.message === 'object' && !Array.isArray(firstChoice.message)
      ? (firstChoice.message as Record<string, unknown>)
      : {};
    const content = this.toAnthropicContentBlocks(message);
    const usage = responseRecord.usage && typeof responseRecord.usage === 'object' && !Array.isArray(responseRecord.usage)
      ? (responseRecord.usage as Record<string, unknown>)
      : {};

    return {
      id: typeof responseRecord.id === 'string' ? `msg_${responseRecord.id.replace(/[^a-zA-Z0-9_-]/g, '')}` : `msg_${requestId.replace(/^req_/, '')}`,
      type: 'message',
      role: 'assistant',
      model,
      content,
      stop_reason: this.mapOpenAiFinishReasonToAnthropic(typeof firstChoice.finish_reason === 'string' ? firstChoice.finish_reason : null),
      stop_sequence: null,
      usage: {
        input_tokens: this.nonNegativeNumber(usage.prompt_tokens ?? usage.input_tokens),
        output_tokens: this.nonNegativeNumber(usage.completion_tokens ?? usage.output_tokens)
      }
    };
  }

  private toAnthropicContentBlocks(message: Record<string, unknown>) {
    const blocks: Array<Record<string, unknown>> = [];

    if (typeof message.content === 'string' && message.content.length > 0) {
      blocks.push({ type: 'text', text: message.content });
    } else if (Array.isArray(message.content)) {
      const text = message.content
        .map((part) => {
          if (part && typeof part === 'object' && !Array.isArray(part) && typeof (part as Record<string, unknown>).text === 'string') {
            return (part as Record<string, string>).text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
      if (text) {
        blocks.push({ type: 'text', text });
      }
    }

    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
          continue;
        }
        const toolRecord = toolCall as Record<string, unknown>;
        const functionValue = toolRecord.function;
        const functionRecord =
          functionValue && typeof functionValue === 'object' && !Array.isArray(functionValue)
            ? (functionValue as Record<string, unknown>)
            : {};
        const name = typeof functionRecord.name === 'string' ? functionRecord.name : 'tool';
        const rawArguments = typeof functionRecord.arguments === 'string' ? functionRecord.arguments : '{}';
        blocks.push({
          type: 'tool_use',
          id: typeof toolRecord.id === 'string' ? toolRecord.id : `toolu_${blocks.length}`,
          name,
          input: this.parseJsonObject(rawArguments)
        });
      }
    }

    return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
  }

  private extractAnthropicContentText(content: unknown): string | null {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const parts = content
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry;
          }
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const record = entry as Record<string, unknown>;
            if (record.type === 'text' && typeof record.text === 'string') {
              return record.text;
            }
            if (typeof record.text === 'string') {
              return record.text;
            }
            if (typeof record.content === 'string') {
              return record.content;
            }
            return this.extractAnthropicContentText(record.content);
          }
          return null;
        })
        .filter((entry): entry is string => Boolean(entry));
      return parts.length > 0 ? parts.join('\n') : null;
    }

    if (content && typeof content === 'object') {
      const record = content as Record<string, unknown>;
      if (typeof record.text === 'string') {
        return record.text;
      }
      if (typeof record.content === 'string') {
        return record.content;
      }
    }

    return null;
  }

  private estimateAnthropicInputTokens(body: AnthropicMessagesBody) {
    const text = [
      body.model,
      this.extractAnthropicContentText(body.system),
      ...body.messages.map((message) => this.extractAnthropicContentText(message.content)),
      ...(body.tools ?? []).map((tool) => JSON.stringify(tool))
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join('\n');
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private parseJsonObject(value: string) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private nonNegativeNumber(value: unknown) {
    return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
  }

  private mapOpenAiFinishReasonToAnthropic(reason: string | null) {
    switch (reason) {
      case 'length':
        return 'max_tokens';
      case 'tool_calls':
      case 'function_call':
        return 'tool_use';
      case 'stop':
      case null:
      case undefined:
        return 'end_turn';
      default:
        return 'stop_sequence';
    }
  }

  private buildAnthropicJsonHeaders(requestId: string, usageEventId?: string) {
    return {
      'content-type': 'application/json',
      'x-request-id': requestId,
      ...(usageEventId ? { 'x-usage-event-id': usageEventId } : {})
    };
  }

  private buildAnthropicStreamHeaders(requestId: string, upstreamHeaders: Record<string, string>) {
    return {
      ...upstreamHeaders,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': upstreamHeaders['cache-control'] ?? 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-request-id': requestId
    };
  }

  private buildOpenAiResponsesHeaders(requestId: string, usageEventId?: string) {
    return {
      'content-type': 'application/json',
      'x-request-id': requestId,
      ...(usageEventId ? { 'x-usage-event-id': usageEventId } : {})
    };
  }

  private async fetchUpstreamChatCompletion(
    baseUrl: string,
    apiKey: string,
    body: ChatCompletionBody,
    options: { stream: boolean; acceptHeader?: string; timeoutMs?: number }
  ) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? UPSTREAM_TIMEOUT_MS);

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
      if (this.isAbortLikeError(error)) {
        throw error;
      }

      throw this.createError(502, 'upstream_error', 'upstream_error', 'Upstream request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private withStreamUsageOptions(body: ChatCompletionBody): ChatCompletionBody {
    const streamOptions = body.stream_options && typeof body.stream_options === 'object' && !Array.isArray(body.stream_options)
      ? (body.stream_options as Record<string, unknown>)
      : {};

    return {
      ...body,
      stream_options: {
        ...streamOptions,
        include_usage: true
      }
    };
  }

  private async recordStreamBilling(
    billing: StreamBillingContext | undefined,
    usage: Record<string, unknown> | null
  ) {
    if (!billing) {
      return;
    }

    try {
      if (usage) {
        await this.billingService.recordCompletedChat({
          ...billing,
          responseBody: { usage }
        });
        return;
      }

      await this.billingService.recordMeteringUnknownChat(billing);
    } catch (error) {
      if (this.isInsufficientBalanceError(error)) {
        await this.billingService.recordFailedChat({
          ...billing,
          errorCode: 'insufficient_balance'
        }).catch((recordError) => {
          console.warn('stream_billing_failed_record_failed', recordError instanceof Error ? recordError.message : 'unknown error');
        });
      }

      console.warn('stream_billing_record_failed', error instanceof Error ? error.message : 'unknown error');
    }
  }

  private isInsufficientBalanceError(error: unknown) {
    if (!(error instanceof ForbiddenException)) {
      return false;
    }

    const response = error.getResponse();
    return Boolean(response && typeof response === 'object' && 'code' in response && response.code === 'insufficient_balance');
  }

  private async findUpstreamMappings(publicModel: string, requiresStream: boolean) {
    const mappings = await this.prisma.upstreamModel.findMany({
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
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: 3
    });

    if (mappings.length === 0) {
      throw this.createError(
        400,
        'model_unavailable',
        'invalid_request_error',
        requiresStream ? 'Model is unavailable for streaming' : 'Model is unavailable'
      );
    }

    return mappings;
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
