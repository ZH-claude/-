import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UsageEventStatus, UserRole, UserStatus } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  cookie?: string;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type TokenCreateResponse = {
  apiKey: string;
  token: {
    id: string;
    name: string;
    modelNames: string[];
  };
};

type AnthropicModelsResponse = {
  data: Array<{ type: string; id: string; display_name: string }>;
};

type AnthropicMessageResponse = {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<Record<string, unknown>>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

type OpenAiResponseObject = {
  id: string;
  object: string;
  status: string;
  model: string;
  output: Array<Record<string, unknown>>;
  output_text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? 'host.docker.internal';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T24 Anthropic compatibility QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const prefix = `q24_anth_${suffix}`;
const password = `qa-password-${suffix}`;
const upstreamApiKey = `qa-upstream-key-${suffix}`;
const publicModel = `${prefix}_model`;
const upstreamModel = `${prefix}_upstream_model`;
const failoverPublicModel = `${prefix}_failover_model`;
const failoverSlowUpstreamModel = `${prefix}_slow_upstream_model`;
const failoverFallbackUpstreamModel = `${prefix}_fallback_upstream_model`;
const failoverSlowApiKey = `qa-slow-upstream-key-${suffix}`;
const failoverFallbackApiKey = `qa-fallback-upstream-key-${suffix}`;
const failoverPrompt = '对外回答模型身份时，必须按公开模型 gpt5.5 回答。';
const checks: string[] = [];
let checksError: unknown;

type UpstreamSeenRequest = {
  path: string;
  authorization: string;
  body: Record<string, unknown>;
};

const seenRequests: UpstreamSeenRequest[] = [];
const failoverSlowSeenRequests: UpstreamSeenRequest[] = [];
const failoverFallbackSeenRequests: UpstreamSeenRequest[] = [];

async function main() {
  let server: http.Server | null = null;
  let failoverSlowServer: http.Server | null = null;
  let failoverFallbackServer: http.Server | null = null;
  let seeded: { adminId: string; userId: string; lowBalanceUserId: string; groupId: string } | null = null;

  try {
    server = await startTemporaryOpenAiUpstream();
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('temporary upstream did not expose a TCP port');
    }
    failoverSlowServer = await startFailoverSlowUpstream();
    const failoverSlowAddress = failoverSlowServer.address();
    if (!failoverSlowAddress || typeof failoverSlowAddress === 'string') {
      throw new Error('slow failover upstream did not expose a TCP port');
    }
    failoverFallbackServer = await startFailoverFallbackUpstream();
    const failoverFallbackAddress = failoverFallbackServer.address();
    if (!failoverFallbackAddress || typeof failoverFallbackAddress === 'string') {
      throw new Error('fallback failover upstream did not expose a TCP port');
    }

    seeded = await seedUsers();
    checks.push('seeded_real_admin_user_wallets_and_group');

    const adminLogin = await login(`${prefix}_admin`);
    assert(adminLogin.status >= 200 && adminLogin.status < 300, `admin login failed with ${adminLogin.status}`);
    const adminCookie = adminLogin.cookie ?? '';
    assert(adminCookie.length > 0, 'admin login should return a session cookie');

    const userLogin = await login(`${prefix}_user`);
    assert(userLogin.status >= 200 && userLogin.status < 300, `user login failed with ${userLogin.status}`);
    const userCookie = userLogin.cookie ?? '';
    assert(userCookie.length > 0, 'user login should return a session cookie');

    const lowBalanceLogin = await login(`${prefix}_low`);
    assert(lowBalanceLogin.status >= 200 && lowBalanceLogin.status < 300, `low balance user login failed with ${lowBalanceLogin.status}`);
    const lowBalanceCookie = lowBalanceLogin.cookie ?? '';
    assert(lowBalanceCookie.length > 0, 'low balance user login should return a session cookie');
    checks.push('real_login_sessions_created');

    const modelCreate = await post('/admin/models', {
      model: publicModel,
      displayName: publicModel,
      inputPriceCentsPer1k: 1,
      outputPriceCentsPer1k: 1,
      modelMultiplier: '1.0000',
      groupIds: [seeded.groupId]
    }, adminCookie);
    assert(modelCreate.status >= 200 && modelCreate.status < 300, `model create failed with ${modelCreate.status}: ${modelCreate.text}`);

    const failoverModelCreate = await post('/admin/models', {
      model: failoverPublicModel,
      displayName: failoverPublicModel,
      inputPriceCentsPer1k: 1,
      outputPriceCentsPer1k: 1,
      modelMultiplier: '1.0000',
      groupIds: [seeded.groupId]
    }, adminCookie);
    assert(failoverModelCreate.status >= 200 && failoverModelCreate.status < 300, `failover model create failed with ${failoverModelCreate.status}: ${failoverModelCreate.text}`);

    const upstreamCreate = await post<{ id: string }>('/admin/upstreams', {
      name: `${prefix}_provider`,
      baseUrl: `http://${TEMP_UPSTREAM_PUBLIC_HOST}:${address.port}`,
      apiKey: upstreamApiKey
    }, adminCookie);
    assert(upstreamCreate.status >= 200 && upstreamCreate.status < 300, `upstream create failed with ${upstreamCreate.status}: ${upstreamCreate.text}`);

    const mappingCreate = await post('/admin/upstream-models', {
      providerId: upstreamCreate.json.id,
      publicModel,
      upstreamModel,
      supportsStream: true
    }, adminCookie);
    assert(mappingCreate.status >= 200 && mappingCreate.status < 300, `mapping create failed with ${mappingCreate.status}: ${mappingCreate.text}`);
    checks.push('created_real_model_upstream_and_mapping');

    const failoverSlowProvider = await post<{ id: string }>('/admin/upstreams', {
      name: `${prefix}_failover_slow_provider`,
      baseUrl: `http://${TEMP_UPSTREAM_PUBLIC_HOST}:${failoverSlowAddress.port}`,
      apiKey: failoverSlowApiKey
    }, adminCookie);
    assert(failoverSlowProvider.status >= 200 && failoverSlowProvider.status < 300, `failover slow upstream create failed with ${failoverSlowProvider.status}: ${failoverSlowProvider.text}`);

    const failoverFallbackProvider = await post<{ id: string }>('/admin/upstreams', {
      name: `${prefix}_failover_fallback_provider`,
      baseUrl: `http://${TEMP_UPSTREAM_PUBLIC_HOST}:${failoverFallbackAddress.port}`,
      apiKey: failoverFallbackApiKey
    }, adminCookie);
    assert(failoverFallbackProvider.status >= 200 && failoverFallbackProvider.status < 300, `failover fallback upstream create failed with ${failoverFallbackProvider.status}: ${failoverFallbackProvider.text}`);

    const failoverSlowMapping = await post('/admin/upstream-models', {
      providerId: failoverSlowProvider.json.id,
      publicModel: failoverPublicModel,
      upstreamModel: failoverSlowUpstreamModel,
      priority: 1,
      timeoutMs: 1000,
      upstreamPrompt: failoverPrompt,
      supportsStream: true
    }, adminCookie);
    assert(failoverSlowMapping.status >= 200 && failoverSlowMapping.status < 300, `failover slow mapping create failed with ${failoverSlowMapping.status}: ${failoverSlowMapping.text}`);

    const failoverFallbackMapping = await post('/admin/upstream-models', {
      providerId: failoverFallbackProvider.json.id,
      publicModel: failoverPublicModel,
      upstreamModel: failoverFallbackUpstreamModel,
      priority: 2,
      timeoutMs: 5000,
      upstreamPrompt: failoverPrompt,
      supportsStream: true
    }, adminCookie);
    assert(failoverFallbackMapping.status >= 200 && failoverFallbackMapping.status < 300, `failover fallback mapping create failed with ${failoverFallbackMapping.status}: ${failoverFallbackMapping.text}`);
    checks.push('created_three_line_ready_failover_mapping_with_prompt');

    const tokenCreate = await post<TokenCreateResponse>('/tokens', {
      name: `${prefix}_token`,
      modelNames: [publicModel, failoverPublicModel]
    }, userCookie);
    assert(tokenCreate.status >= 200 && tokenCreate.status < 300, `token create failed with ${tokenCreate.status}: ${tokenCreate.text}`);
    assert(tokenCreate.json.apiKey.startsWith('sk-nr-'), 'created user token should use platform key prefix');
    checks.push('created_real_user_token');

    const lowBalanceTokenCreate = await post<TokenCreateResponse>('/tokens', {
      name: `${prefix}_low_balance_token`,
      modelNames: [publicModel]
    }, lowBalanceCookie);
    assert(lowBalanceTokenCreate.status >= 200 && lowBalanceTokenCreate.status < 300, `low balance token create failed with ${lowBalanceTokenCreate.status}: ${lowBalanceTokenCreate.text}`);

    const models = await request<AnthropicModelsResponse>('GET', '/v1/models', undefined, undefined, tokenCreate.json.apiKey);
    assert(models.status === 200, `Anthropic models request failed with ${models.status}: ${models.text}`);
    assert(models.json.data.some((entry) => entry.type === 'model' && entry.id === publicModel), 'Anthropic models response missing public model');
    checks.push('anthropic_model_list_accepts_x_api_key');

    const bearerModels = await requestBearer<AnthropicModelsResponse>('GET', '/v1/models', undefined, tokenCreate.json.apiKey);
    assert(bearerModels.status === 200, `Bearer models request failed with ${bearerModels.status}: ${bearerModels.text}`);
    assert(bearerModels.json.data.some((entry) => entry.type === 'model' && entry.display_name === publicModel), 'Bearer model list should include Anthropic-compatible fields');
    checks.push('model_list_accepts_bearer_token_with_anthropic_compatible_fields');

    const bearerModelsWithoutVersion = await requestBearerWithoutAnthropicVersion<AnthropicModelsResponse>('GET', '/v1/models', undefined, tokenCreate.json.apiKey);
    assert(bearerModelsWithoutVersion.status === 200, `Bearer models without Anthropic version failed with ${bearerModelsWithoutVersion.status}: ${bearerModelsWithoutVersion.text}`);
    assert(
      bearerModelsWithoutVersion.json.data.some((entry) => entry.type === 'model' && entry.display_name === publicModel),
      'Bearer model list without Anthropic version should still include Anthropic-compatible fields'
    );
    checks.push('model_list_without_anthropic_version_keeps_anthropic_compatible_fields');

    const count = await request<{ input_tokens: number }>('POST', '/v1/messages/count_tokens', createAnthropicBody(false), undefined, tokenCreate.json.apiKey);
    assert(count.status === 200, `count_tokens failed with ${count.status}: ${count.text}`);
    assert(Number.isInteger(count.json.input_tokens) && count.json.input_tokens > 0, 'count_tokens should return positive computed input_tokens');
    checks.push('anthropic_count_tokens_returns_computed_value');

    const countWithoutMaxTokens = await request<{ input_tokens: number }>(
      'POST',
      '/v1/messages/count_tokens',
      createAnthropicCountBodyWithoutMaxTokens(),
      undefined,
      tokenCreate.json.apiKey
    );
    assert(countWithoutMaxTokens.status === 200, `count_tokens without max_tokens failed with ${countWithoutMaxTokens.status}: ${countWithoutMaxTokens.text}`);
    assert(Number.isInteger(countWithoutMaxTokens.json.input_tokens) && countWithoutMaxTokens.json.input_tokens > 0, 'count_tokens without max_tokens should return positive input_tokens');
    checks.push('anthropic_count_tokens_does_not_require_max_tokens');

    const message = await request<AnthropicMessageResponse>('POST', '/v1/messages', createAnthropicBody(false), undefined, tokenCreate.json.apiKey);
    assert(message.status === 200, `Anthropic message failed with ${message.status}: ${message.text}`);
    assert(message.json.type === 'message', 'Anthropic response type should be message');
    assert(message.json.model === publicModel, 'Anthropic response model should stay public model');
    assert(message.json.content.some((block) => block.type === 'text' && block.text === 'Claude compatible OK'), 'Anthropic response missing text block');
    assert(message.json.content.some((block) => block.type === 'tool_use' && block.name === 'lookup'), 'Anthropic response missing tool_use block');
    assert(message.json.stop_reason === 'tool_use', 'tool finish should become Anthropic tool_use stop reason');
    assert(message.json.usage.input_tokens === 9 && message.json.usage.output_tokens === 4, 'usage should be mapped to input/output tokens');
    checks.push('anthropic_non_stream_message_translates_openai_response');

    const failoverMessage = await request<AnthropicMessageResponse>('POST', '/v1/messages', createAnthropicFailoverBody(), undefined, tokenCreate.json.apiKey);
    assert(failoverMessage.status === 200, `Anthropic failover message failed with ${failoverMessage.status}: ${failoverMessage.text}`);
    assert(failoverMessage.json.model === failoverPublicModel, 'failover response model should stay public model');
    assert(failoverSlowSeenRequests.length >= 1, 'slow upstream should receive the first failover attempt');
    assert(failoverFallbackSeenRequests.length >= 1, 'fallback upstream should receive the second failover attempt');
    assert(failoverFallbackSeenRequests.some((entry) => entry.authorization === `Bearer ${failoverFallbackApiKey}`), 'fallback upstream should receive its own real upstream key');
    assert(failoverFallbackSeenRequests.some((entry) => entry.body.model === failoverFallbackUpstreamModel), 'fallback upstream should receive mapped fallback model');
    assert(failoverFallbackSeenRequests.some((entry) => {
      const messages = Array.isArray(entry.body.messages) ? entry.body.messages : [];
      return messages.some((message) =>
        message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        (message as Record<string, unknown>).role === 'system' &&
        typeof (message as Record<string, unknown>).content === 'string' &&
        String((message as Record<string, unknown>).content).includes(failoverPrompt)
      );
    }), 'fallback upstream should receive configured merchant prompt');
    checks.push('failover_switches_after_timeout_and_injects_model_prompt');

    const streamUsageBefore = await countBillableStreamUsage(seeded.userId);
    const stream = await requestRawStream('/v1/messages', createAnthropicBody(true), tokenCreate.json.apiKey);
    assert(stream.status === 200, `Anthropic stream failed with ${stream.status}: ${stream.text}`);
    assert(stream.text.includes('event: message_start'), 'stream should include message_start');
    assert(stream.text.includes('event: content_block_delta'), 'stream should include content deltas');
    assert(stream.text.includes('"text":"娴佸紡姝ｅ父"') || stream.text.includes('娴佸紡'), 'stream should include upstream text');
    assert(stream.text.includes('event: message_stop'), 'stream should include message_stop');
    checks.push('anthropic_stream_translates_openai_sse');

    const streamUsageAfter = await countBillableStreamUsage(seeded.userId);
    assert(streamUsageAfter === streamUsageBefore + 1, 'Anthropic stream should write one real billable usage event');
    checks.push('anthropic_stream_records_billable_usage');

    const openAiStreamUsageBefore = await countBillableStreamUsage(seeded.userId);
    const openAiStream = await requestRawOpenAiChatStream(createOpenAiChatStreamBody(), tokenCreate.json.apiKey);
    assert(openAiStream.status === 200, `OpenAI chat stream failed with ${openAiStream.status}: ${openAiStream.text}`);
    assert(openAiStream.text.includes('data:'), 'OpenAI chat stream should return SSE data');
    assert(openAiStream.text.includes('[DONE]'), 'OpenAI chat stream should include DONE marker');
    const openAiStreamUsageAfter = await countBillableStreamUsage(seeded.userId);
    assert(openAiStreamUsageAfter === openAiStreamUsageBefore + 1, 'OpenAI chat stream should write one real billable usage event');
    checks.push('openai_chat_stream_records_billable_usage');

    const insufficientBalanceUsageBefore = await countInsufficientBalanceUsage(seeded.lowBalanceUserId);
    const insufficientBalanceStream = await requestRawStream('/v1/messages', createAnthropicHighUsageStreamBody(), lowBalanceTokenCreate.json.apiKey);
    assert(insufficientBalanceStream.status === 200, `low balance stream should still return upstream response, got ${insufficientBalanceStream.status}: ${insufficientBalanceStream.text}`);
    const insufficientBalanceUsageAfter = await countInsufficientBalanceUsage(seeded.lowBalanceUserId);
    assert(
      insufficientBalanceUsageAfter === insufficientBalanceUsageBefore + 1,
      'low balance stream should write one failed insufficient_balance usage event'
    );
    checks.push('anthropic_stream_records_failed_usage_when_balance_insufficient');

    const bearerMessage = await requestBearer<AnthropicMessageResponse>('POST', '/v1/messages', createAnthropicBody(false), tokenCreate.json.apiKey);
    assert(bearerMessage.status === 200, `Anthropic bearer message failed with ${bearerMessage.status}: ${bearerMessage.text}`);
    checks.push('anthropic_message_accepts_bearer_token');

    const mixedRoleMessage = await request<AnthropicMessageResponse>('POST', '/v1/messages', createAnthropicBodyWithMixedRoles(), undefined, tokenCreate.json.apiKey);
    assert(mixedRoleMessage.status === 200, `Anthropic message with non-user top-level role failed with ${mixedRoleMessage.status}: ${mixedRoleMessage.text}`);
    checks.push('anthropic_messages_with_non_user_role_should_not_400');

    const toolResultMessage = await request<AnthropicMessageResponse>('POST', '/v1/messages', createAnthropicToolResultBody(), undefined, tokenCreate.json.apiKey);
    assert(toolResultMessage.status === 200, `Anthropic tool result message failed with ${toolResultMessage.status}: ${toolResultMessage.text}`);
    checks.push('anthropic_tool_result_messages_translate_to_openai_tool_messages');

    const responseObject = await request<OpenAiResponseObject>('POST', '/v1/responses', createResponsesBody(false), undefined, tokenCreate.json.apiKey);
    assert(responseObject.status === 200, `OpenAI Responses request failed with ${responseObject.status}: ${responseObject.text}`);
    assert(responseObject.json.object === 'response', 'Responses API should return response object');
    assert(responseObject.json.status === 'completed', 'Responses API status should be completed');
    assert(responseObject.json.model === publicModel, 'Responses API should keep public model in response');
    assert(responseObject.json.output_text === 'Claude compatible OK', 'Responses API should expose output_text');
    assert(responseObject.json.output.some((item) => item.type === 'function_call'), 'Responses API should expose function_call output item');
    assert(responseObject.json.usage.input_tokens === 9 && responseObject.json.usage.output_tokens === 4, 'Responses usage should map tokens');
    checks.push('openai_responses_api_translates_to_existing_relay');

    const responseStream = await requestRawResponsesStream('/v1/responses', createResponsesBody(true), tokenCreate.json.apiKey);
    assert(responseStream.status === 200, `OpenAI Responses stream failed with ${responseStream.status}: ${responseStream.text}`);
    assert(responseStream.text.includes('event: response.created'), 'Responses stream should include response.created');
    assert(responseStream.text.includes('event: response.output_text.delta'), 'Responses stream should include output text delta');
    assert(responseStream.text.includes('event: response.function_call_arguments.delta'), 'Responses stream should include function call argument delta');
    assert(responseStream.text.includes('event: response.function_call_arguments.done'), 'Responses stream should include function call argument done');
    assert(responseStream.text.includes('event: response.completed'), 'Responses stream should include response.completed');
    checks.push('openai_responses_stream_shape_is_supported');

    const meteringUnknownUsage = await prisma.usageEvent.count({
      where: {
        userId: seeded.userId,
        model: publicModel,
        status: UsageEventStatus.METERING_UNKNOWN
      }
    });
    assert(meteringUnknownUsage === 0, `stream calls should not create METERING_UNKNOWN rows when upstream reports usage, got ${meteringUnknownUsage}`);
    checks.push('upstream_usage_streams_do_not_create_metering_unknown_rows');

    assert(seenRequests.length >= 3, `expected fake upstream to receive at least 3 chat requests, got ${seenRequests.length}`);
    assert(seenRequests.every((entry) => entry.path === '/v1/chat/completions'), 'upstream path should remain OpenAI-compatible');
    assert(seenRequests.every((entry) => entry.authorization === `Bearer ${upstreamApiKey}`), 'upstream should receive configured upstream key');
    assert(seenRequests.every((entry) => entry.body.model === upstreamModel), 'upstream should receive mapped upstream model');
    assert(seenRequests.some((entry) => Array.isArray(entry.body.tools)), 'upstream should receive converted tool definitions');
    assert(seenRequests.some((entry) => {
      const messages = Array.isArray(entry.body.messages) ? entry.body.messages : [];
      return messages.some((message) =>
        message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        (message as Record<string, unknown>).role === 'system' &&
        (message as Record<string, unknown>).content === 'Use strict policy for follow-up answers.'
      );
    }), 'upstream should receive converted system role messages');
    assert(seenRequests.some((entry) => {
      const messages = Array.isArray(entry.body.messages) ? entry.body.messages : [];
      return messages.some((message) =>
        message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        (message as Record<string, unknown>).role === 'tool' &&
        (message as Record<string, unknown>).tool_call_id === 'call_lookup'
      );
    }), 'upstream should receive converted tool_result messages');
    assert(!seenRequests.some((entry) => {
      const messages = Array.isArray(entry.body.messages) ? entry.body.messages : [];
      return messages.some((message) =>
        message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        (message as Record<string, unknown>).role === 'user' &&
        typeof (message as Record<string, unknown>).content === 'object' &&
        !Array.isArray((message as Record<string, unknown>).content)
      );
    }), 'single user text blocks should not be sent as raw object content');
    checks.push('upstream_received_translated_openai_payload_and_real_key');
  } catch (error) {
    checksError = error;
  } finally {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (failoverSlowServer) {
      await new Promise<void>((resolve) => failoverSlowServer.close(() => resolve()));
    }
    if (failoverFallbackServer) {
      await new Promise<void>((resolve) => failoverFallbackServer.close(() => resolve()));
    }
    await cleanup();
    const residual = await countResidual();
    await prisma.$disconnect();
    console.log(JSON.stringify({ ok: checksError === undefined, checks, residual, seenUpstreamRequests: seenRequests.length }, null, 2));
    assertResidualZero(residual);
  }

  if (checksError) {
    throw checksError;
  }
}

function createAnthropicBody(stream: boolean) {
  return {
    model: publicModel,
    max_tokens: 64,
    stream,
    system: 'You are testing a relay.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'hello'
          }
        ]
      }
    ],
    tools: [
      {
        name: 'lookup',
        description: 'Lookup test data',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        }
      }
    ]
  };
}

function createAnthropicCountBodyWithoutMaxTokens() {
  return {
    model: publicModel,
    messages: [
      {
        role: 'user',
        content: 'hello'
      }
    ]
  };
}

function createAnthropicFailoverBody() {
  return {
    model: failoverPublicModel,
    max_tokens: 64,
    stream: false,
    messages: [
      {
        role: 'user',
        content: 'who are you'
      }
    ]
  };
}

function createAnthropicHighUsageStreamBody() {
  return {
    model: publicModel,
    max_tokens: 64,
    stream: true,
    messages: [
      {
        role: 'user',
        content: 'expensive stream'
      }
    ]
  };
}

function createAnthropicToolResultBody() {
  return {
    model: publicModel,
    max_tokens: 64,
    stream: false,
    messages: [
      {
        role: 'user',
        content: 'please call lookup'
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_lookup',
            name: 'lookup',
            input: {
              query: 'ok'
            }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'tool output follows'
          },
          {
            type: 'tool_result',
            tool_use_id: 'call_lookup',
            content: 'lookup finished'
          }
        ]
      }
    ]
  };
}

function createAnthropicBodyWithMixedRoles() {
  return {
    model: publicModel,
    max_tokens: 64,
    stream: false,
    messages: [
      {
        role: 'system',
        content: [
          {
            type: 'text',
            text: 'Use strict policy for follow-up answers.'
          }
        ]
      },
      {
        role: 'user',
        content: 'check role handling'
      }
    ]
  };
}

function createOpenAiChatStreamBody() {
  return {
    model: publicModel,
    stream: true,
    messages: [
      {
        role: 'user',
        content: 'hello'
      }
    ]
  };
}

function createResponsesBody(stream: boolean) {
  return {
    model: publicModel,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'hello'
          }
        ]
      }
    ],
    instructions: 'You are testing a relay.',
    stream,
    max_output_tokens: 64,
    tools: [
      {
        type: 'function',
        name: 'lookup',
        description: 'Lookup test data',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        }
      }
    ]
  };
}

async function startTemporaryOpenAiUpstream() {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) as Record<string, unknown> : {};
    seenRequests.push({
      path: request.url ?? '',
      authorization: request.headers.authorization ?? '',
      body
    });

    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }

    if (body.stream) {
      const highUsage = JSON.stringify(body).includes('expensive stream');
      const usage = highUsage
        ? { prompt_tokens: 3000, completion_tokens: 1000, total_tokens: 4000 }
        : { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 };

      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache'
      });
      response.write(`data: ${JSON.stringify({ id: 'chatcmpl-stream', choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'chatcmpl-stream', choices: [{ index: 0, delta: { content: '娴佸紡' } }] })}\n\n`);
      response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-stream',
        choices: [{ index: 0, delta: { content: '姝ｅ父' }, finish_reason: 'stop' }],
        usage
      })}\n\n`);
      response.write('data: [DONE]\n\n');
      response.end();
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'chatcmpl-t24',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Claude compatible OK',
            tool_calls: [
              {
                id: 'call_lookup',
                type: 'function',
                function: {
                  name: 'lookup',
                  arguments: '{"query":"ok"}'
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: {
        prompt_tokens: 9,
        completion_tokens: 4,
        total_tokens: 13
      }
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  return server;
}

async function startFailoverSlowUpstream() {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    failoverSlowSeenRequests.push({
      path: request.url ?? '',
      authorization: request.headers.authorization ?? '',
      body: text ? JSON.parse(text) as Record<string, unknown> : {}
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    if (response.destroyed) {
      return;
    }

    response.writeHead(504, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'slow upstream timed out' } }));
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  return server;
}

async function startFailoverFallbackUpstream() {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) as Record<string, unknown> : {};
    failoverFallbackSeenRequests.push({
      path: request.url ?? '',
      authorization: request.headers.authorization ?? '',
      body
    });

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'chatcmpl-failover',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: body.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Failover OK'
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 5,
        completion_tokens: 2,
        total_tokens: 7
      }
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', () => resolve()));
  return server;
}

async function seedUsers() {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.create({
      data: {
        code: `${prefix}_group`,
        name: `${prefix} group`
      }
    });

    const admin = await tx.user.create({
      data: {
        username: `${prefix}_admin`,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${prefix}_admin_invite`
      }
    });

    const user = await tx.user.create({
      data: {
        username: `${prefix}_user`,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${prefix}_user_invite`
      }
    });

    const lowBalanceUser = await tx.user.create({
      data: {
        username: `${prefix}_low`,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${prefix}_low_balance_invite`
      }
    });

    await tx.wallet.createMany({
      data: [
        { userId: admin.id, balanceCents: 0 },
        { userId: user.id, balanceCents: 100_000 },
        { userId: lowBalanceUser.id, balanceCents: 1 }
      ]
    });

    return {
      adminId: admin.id,
      userId: user.id,
      lowBalanceUserId: lowBalanceUser.id,
      groupId: group.id
    };
  });
}

async function login(username: string) {
  return request<LoginResponse>('POST', '/auth/login', { username, password });
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function request<T = unknown>(method: string, path: string, body?: unknown, cookie?: string, apiKey?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(apiKey ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: text ? JSON.parse(text) as T : ({} as T),
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function requestBearer<T = unknown>(method: string, path: string, body: unknown | undefined, apiKey: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${apiKey}`,
      'anthropic-version': '2023-06-01'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: text ? JSON.parse(text) as T : ({} as T)
  };
}

async function requestBearerWithoutAnthropicVersion<T = unknown>(method: string, path: string, body: unknown | undefined, apiKey: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      authorization: `Bearer ${apiKey}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: text ? JSON.parse(text) as T : ({} as T)
  };
}

async function requestRawStream(path: string, body: unknown, apiKey: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    text: await response.text()
  };
}

async function requestRawOpenAiChatStream(body: unknown, apiKey: string) {
  const response = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    text: await response.text()
  };
}

async function requestRawResponsesStream(path: string, body: unknown, apiKey: string) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    text: await response.text()
  };
}

async function countBillableStreamUsage(userId: string) {
  return prisma.usageEvent.count({
    where: {
      userId,
      model: publicModel,
      status: UsageEventStatus.BILLABLE,
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
      costCents: 1
    }
  });
}

async function countInsufficientBalanceUsage(userId: string) {
  return prisma.usageEvent.count({
    where: {
      userId,
      model: publicModel,
      status: UsageEventStatus.FAILED,
      errorCode: 'insufficient_balance'
    }
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const groups = await prisma.userGroup.findMany({
    where: { code: { startsWith: prefix } },
    select: { id: true }
  });
  const groupIds = groups.map((group) => group.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
  const modelPrices = await prisma.modelPrice.findMany({
    where: { model: { startsWith: prefix } },
    select: { id: true, model: true }
  });
  const modelIds = modelPrices.map((model) => model.id);
  const modelNames = modelPrices.map((model) => model.model);
  const tokens = await prisma.apiToken.findMany({
    where: { userId: { in: userIds } },
    select: { id: true }
  });
  const tokenIds = tokens.map((token) => token.id);

  await prisma.requestLog.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { upstreamProviderId: { in: providerIds } },
        { model: { in: modelNames } }
      ]
    }
  });
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.usageEvent.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { upstreamProviderId: { in: providerIds } },
        { model: { in: modelNames } }
      ]
    }
  });
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: userIds } },
        { targetId: { in: groupIds } },
        { targetId: { in: modelIds } },
        { targetId: { in: providerIds } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } },
        { targetId: { in: tokenIds } }
      ]
    }
  });
  await prisma.apiTokenModelAccess.deleteMany({ where: { apiTokenId: { in: tokenIds } } });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });
  await prisma.upstreamModel.deleteMany({
    where: {
      OR: [
        { providerId: { in: providerIds } },
        { publicModel: { in: modelNames } }
      ]
    }
  });
  await prisma.modelGroupAccess.deleteMany({
    where: {
      OR: [
        { groupId: { in: groupIds } },
        { modelPriceId: { in: modelIds } }
      ]
    }
  });
  await prisma.modelPrice.deleteMany({ where: { id: { in: modelIds } } });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.userGroup.deleteMany({ where: { id: { in: groupIds } } });
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const groups = await prisma.userGroup.findMany({
    where: { code: { startsWith: prefix } },
    select: { id: true }
  });
  const groupIds = groups.map((group) => group.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
  const models = await prisma.modelPrice.findMany({
    where: { model: { startsWith: prefix } },
    select: { id: true, model: true }
  });
  const modelIds = models.map((model) => model.id);
  const modelNames = models.map((model) => model.model);
  const tokens = await prisma.apiToken.findMany({
    where: { userId: { in: userIds } },
    select: { id: true }
  });
  const tokenIds = tokens.map((token) => token.id);

  return {
    users: users.length,
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    groups: groups.length,
    modelPrices: models.length,
    providers: providers.length,
    upstreamModels: await prisma.upstreamModel.count({
      where: { OR: [{ providerId: { in: providerIds } }, { publicModel: { in: modelNames } }] }
    }),
    tokens: tokenIds.length,
    tokenModelAccesses: await prisma.apiTokenModelAccess.count({ where: { apiTokenId: { in: tokenIds } } }),
    modelGroupAccesses: await prisma.modelGroupAccess.count({
      where: { OR: [{ groupId: { in: groupIds } }, { modelPriceId: { in: modelIds } }] }
    }),
    usageEvents: await prisma.usageEvent.count({
      where: {
        OR: [
          { userId: { in: userIds } },
          { tokenId: { in: tokenIds } },
          { upstreamProviderId: { in: providerIds } },
          { model: { in: modelNames } }
        ]
      }
    }),
    requestLogs: await prisma.requestLog.count({
      where: {
        OR: [
          { userId: { in: userIds } },
          { tokenId: { in: tokenIds } },
          { upstreamProviderId: { in: providerIds } },
          { model: { in: modelNames } }
        ]
      }
    })
  };
}

function assertResidualZero(residual: Awaited<ReturnType<typeof countResidual>>) {
  for (const [key, value] of Object.entries(residual)) {
    assert(value === 0, `residual ${key} should be 0, got ${value}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
