import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ModelStatus,
  PrismaClient,
  UpstreamHealthStatus,
  UpstreamProviderKind,
  UpstreamProviderStatus
} from '../src/generated/prisma/client';
import { encryptUpstreamApiKey, maskUpstreamApiKey } from '../src/admin/upstream-key-crypto';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  headers: Headers;
  text: string;
  cookie?: string;
};

type RegisterResponse = {
  user: {
    id: string;
    username: string;
  };
};

type TokenResponse = {
  apiKey: string;
  token: {
    id: string;
    name: string;
  };
};

type TemporaryUpstream = {
  label: string;
  baseUrl: string;
  close: () => void;
  getRequestCount: () => number;
  getMaxConcurrent: () => number;
  setFailureStatus: (status: number | null) => void;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;
const TEMP_UPSTREAM_PUBLIC_HOST = process.env.TEMP_UPSTREAM_PUBLIC_HOST ?? '127.0.0.1';
const UPSTREAM_RESPONSE_DELAY_MS = Number(process.env.T31_UPSTREAM_RESPONSE_DELAY_MS ?? 700);

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T31 upstream assignment concurrency QA script');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t31_${suffix}`;
const password = `qa-password-${suffix}`;
const publicModel = `${prefix}-fixed-route-model`;
const upstreamModel = `${prefix}-upstream-model`;
const providerAName = `${prefix}-deepseek-a`;
const providerBName = `${prefix}-deepseek-b`;
const upstreamKeyA = `qa-t31-upstream-a-${suffix}`;
const upstreamKeyB = `qa-t31-upstream-b-${suffix}`;
const requestIds: string[] = [];
const checks: string[] = [];

async function main() {
  const upstreamA = await startTemporaryUpstream('upstream-a', upstreamKeyA);
  const upstreamB = await startTemporaryUpstream('upstream-b', upstreamKeyB);

  try {
    const userA = await register(`${prefix}_user_a`);
    const userB = await register(`${prefix}_user_b`);
    const [profileA, profileB] = await Promise.all([
      getUser(userA.user.username),
      getUser(userB.user.username)
    ]);

    await seedModelAndTwoUpstreams(profileA.id, [profileA.group.id, profileB.group.id], upstreamA, upstreamB);
    await prisma.wallet.updateMany({
      where: { userId: { in: [profileA.id, profileB.id] } },
      data: { balanceCents: 100_000, totalSpendCents: 0 }
    });

    const tokenA = await createToken(userA.cookie!, `${prefix}_token_a`);
    const tokenB = await createToken(userB.cookie!, `${prefix}_token_b`);

    const warmupA = await relayChat(tokenA.apiKey, 'warmup user a');
    assert(warmupA.status === 200, `warmup user A failed with ${warmupA.status}: ${warmupA.text}`);
    requestIds.push(requireRequestId(warmupA, 'warmup user A'));
    const assignmentA1 = await getAssignment(profileA.id);
    assert(assignmentA1, 'user A did not receive a fixed upstream assignment');
    checks.push('first_user_receives_fixed_upstream_assignment');

    const repeatA = await relayChat(tokenA.apiKey, 'repeat user a');
    assert(repeatA.status === 200, `repeat user A failed with ${repeatA.status}: ${repeatA.text}`);
    requestIds.push(requireRequestId(repeatA, 'repeat user A'));
    const assignmentA2 = await getAssignment(profileA.id);
    assert(
      assignmentA2?.upstreamProviderId === assignmentA1.upstreamProviderId,
      'user A fixed upstream changed between successful requests'
    );
    checks.push('same_user_keeps_same_upstream_provider');

    const warmupB = await relayChat(tokenB.apiKey, 'warmup user b');
    assert(warmupB.status === 200, `warmup user B failed with ${warmupB.status}: ${warmupB.text}`);
    requestIds.push(requireRequestId(warmupB, 'warmup user B'));
    const assignmentB = await getAssignment(profileB.id);
    assert(assignmentB, 'user B did not receive a fixed upstream assignment');
    assert(
      assignmentB.upstreamProviderId !== assignmentA1.upstreamProviderId,
      'second user should be assigned to the other active upstream when assignment counts differ'
    );
    checks.push('second_user_balances_to_other_active_upstream');

    const concurrentUsers = await Promise.all(
      Array.from({ length: 8 }, (_, index) => register(`${prefix}_p${index + 1}`))
    );
    const concurrentProfiles = await Promise.all(concurrentUsers.map((user) => getUser(user.user.username)));
    await prisma.wallet.updateMany({
      where: { userId: { in: concurrentProfiles.map((profile) => profile.id) } },
      data: { balanceCents: 100_000, totalSpendCents: 0 }
    });
    const concurrentTokens = await Promise.all(
      concurrentUsers.map((user, index) => createToken(user.cookie!, `${prefix}_parallel_token_${index + 1}`))
    );
    const concurrentFirstResults = await Promise.all(
      concurrentTokens.map((token, index) => relayChat(token.apiKey, `parallel first assignment ${index + 1}`))
    );
    for (const [index, result] of concurrentFirstResults.entries()) {
      assert(
        result.status === 200 || result.status === 429,
        `parallel first assignment ${index + 1} should either complete or hit provider concurrency, got ${result.status}: ${result.text}`
      );
      requestIds.push(requireRequestId(result, `parallel first assignment ${index + 1}`));
    }
    const concurrentAssignments = await Promise.all(concurrentProfiles.map((profile) => getAssignment(profile.id)));
    const missingParallelAssignment = concurrentAssignments.findIndex((assignment) => !assignment);
    assert(missingParallelAssignment === -1, `parallel user ${missingParallelAssignment + 1} did not receive a fixed upstream assignment`);
    const parallelAssignmentCounts = countAssignmentsByProvider(concurrentAssignments);
    assert(
      parallelAssignmentCounts.size === 2,
      `parallel first assignments should use both upstream providers, got ${JSON.stringify(Object.fromEntries(parallelAssignmentCounts))}`
    );
    const parallelCounts = Array.from(parallelAssignmentCounts.values());
    assert(
      Math.max(...parallelCounts) - Math.min(...parallelCounts) <= 1,
      `parallel first assignments should remain balanced, got ${JSON.stringify(Object.fromEntries(parallelAssignmentCounts))}`
    );
    checks.push('concurrent_new_users_are_balanced_across_fixed_upstreams');

    const firstConcurrent = relayChat(tokenA.apiKey, 'concurrency hold first');
    await delay(100);
    const secondConcurrent = await relayChat(tokenA.apiKey, 'concurrency should be limited');
    const firstConcurrentResult = await firstConcurrent;
    const concurrentResults = [firstConcurrentResult, secondConcurrent];
    const successResult = concurrentResults.find((result) => result.status === 200);
    const limitedResult = concurrentResults.find((result) => result.status === 429);
    assert(successResult, `expected one concurrent request to succeed, got ${concurrentResults.map((result) => result.status).join(', ')}`);
    assert(limitedResult, `expected one concurrent request to be limited, got ${concurrentResults.map((result) => result.status).join(', ')}`);
    requestIds.push(requireRequestId(successResult, 'concurrency success'));
    const limitedRequestId = requireRequestId(limitedResult, 'concurrency limited');
    requestIds.push(limitedRequestId);
    assert(isConcurrencyLimitError(limitedResult), 'limited response did not use upstream_concurrency_exceeded error code');

    const limitedUsageEvents = await prisma.usageEvent.count({
      where: { requestId: limitedRequestId }
    });
    assert(limitedUsageEvents === 0, 'concurrency-limited request should not create a failed usage event');
    const limitedLog = await prisma.requestLog.findUnique({
      where: { requestId: limitedRequestId }
    });
    assert(limitedLog?.errorCode === 'upstream_concurrency_exceeded', 'request log did not record concurrency error code');
    assert(limitedLog.upstreamStatus === 'concurrency_limited', 'request log did not record concurrency_limited upstream status');
    assert(
      limitedLog.upstreamProviderId === assignmentA1.upstreamProviderId,
      'concurrency-limited request should be attributed to the fixed provider'
    );
    checks.push('concurrency_limit_returns_429_without_failed_usage_event');

    const activeSlots = await prisma.upstreamConcurrencySlot.count({
      where: { upstreamProviderId: assignmentA1.upstreamProviderId }
    });
    assert(activeSlots === 0, `upstream concurrency slots should be released after requests finish, found ${activeSlots}`);
    checks.push('upstream_concurrency_slots_are_released');

    const providerCounts = await prisma.upstreamProvider.findMany({
      where: { name: { startsWith: prefix } },
      select: {
        name: true,
        maxConcurrency: true,
        _count: {
          select: {
            userAssignments: true
          }
        }
      },
      orderBy: { name: 'asc' }
    });
    assert(providerCounts.every((provider) => provider.maxConcurrency === 1), 'seeded providers should keep maxConcurrency=1');
    checks.push('provider_max_concurrency_is_persisted');

    const fixedTemporaryUpstream = assignmentA1.upstreamProvider.name === providerAName ? upstreamA : upstreamB;
    const backupTemporaryUpstream = fixedTemporaryUpstream === upstreamA ? upstreamB : upstreamA;
    const backupProviderId = assignmentB.upstreamProviderId;
    const fixedRequestsBeforeFailover = fixedTemporaryUpstream.getRequestCount();
    const backupRequestsBeforeFailover = backupTemporaryUpstream.getRequestCount();
    fixedTemporaryUpstream.setFailureStatus(502);

    for (let index = 0; index < 3; index += 1) {
      const failoverResult = await relayChat(tokenA.apiKey, `primary failover ${index + 1}`);
      assert(
        failoverResult.status === 200,
        `failover request ${index + 1} should succeed through backup upstream, got ${failoverResult.status}: ${failoverResult.text}`
      );
      const failoverRequestId = requireRequestId(failoverResult, `failover request ${index + 1}`);
      requestIds.push(failoverRequestId);
      const failoverLog = await getRequestLog(failoverRequestId);
      assert(failoverLog, 'failover request should write a request log');
      assert(failoverLog.upstreamProviderId === backupProviderId, 'failover request should be attributed to the backup provider');
      assert(failoverLog.upstreamStatus === 'success_after_failover', 'failover request log should mark success_after_failover');
    }

    const assignmentAfterFailover = await getAssignment(profileA.id);
    assert(
      assignmentAfterFailover?.upstreamProviderId === assignmentA1.upstreamProviderId,
      'failover should not rewrite the user fixed upstream assignment'
    );
    const failedProvider = await prisma.upstreamProvider.findUniqueOrThrow({
      where: { id: assignmentA1.upstreamProviderId },
      select: {
        healthStatus: true,
        consecutiveFailures: true,
        circuitOpenedUntil: true,
        lastFailureAt: true
      }
    });
    assert(failedProvider.healthStatus === UpstreamHealthStatus.UNHEALTHY, 'failed primary provider should be marked unhealthy');
    assert(failedProvider.consecutiveFailures >= 3, 'failed primary provider should persist consecutive failure count');
    assert(
      failedProvider.circuitOpenedUntil !== null && failedProvider.circuitOpenedUntil > new Date(),
      'failed primary provider should open the circuit after repeated failures'
    );
    assert(failedProvider.lastFailureAt !== null, 'failed primary provider should record lastFailureAt');
    assert(
      fixedTemporaryUpstream.getRequestCount() >= fixedRequestsBeforeFailover + 3,
      'fixed primary upstream should receive the failing attempts before circuit opens'
    );
    assert(
      backupTemporaryUpstream.getRequestCount() >= backupRequestsBeforeFailover + 3,
      'backup upstream should receive successful failover attempts'
    );
    checks.push('primary_failure_fails_over_without_rewriting_fixed_assignment');
    checks.push('repeated_primary_failures_open_provider_circuit');

    const fixedRequestsBeforeCircuitSkip = fixedTemporaryUpstream.getRequestCount();
    const backupRequestsBeforeCircuitSkip = backupTemporaryUpstream.getRequestCount();
    const circuitSkipResult = await relayChat(tokenA.apiKey, 'circuit-open primary should be skipped');
    assert(
      circuitSkipResult.status === 200,
      `circuit-open primary should be skipped, got ${circuitSkipResult.status}: ${circuitSkipResult.text}`
    );
    const circuitSkipRequestId = requireRequestId(circuitSkipResult, 'circuit-open skip request');
    requestIds.push(circuitSkipRequestId);
    const circuitSkipLog = await getRequestLog(circuitSkipRequestId);
    assert(circuitSkipLog, 'circuit-open request should write a request log');
    assert(circuitSkipLog.upstreamProviderId === backupProviderId, 'circuit-open request should be attributed to backup provider');
    assert(circuitSkipLog.upstreamStatus === 'success', 'circuit-open skip should succeed without a failed first attempt');
    assert(
      fixedTemporaryUpstream.getRequestCount() === fixedRequestsBeforeCircuitSkip,
      'circuit-open primary should not receive another upstream request'
    );
    assert(
      backupTemporaryUpstream.getRequestCount() === backupRequestsBeforeCircuitSkip + 1,
      'backup upstream should receive the circuit-open skip request'
    );
    fixedTemporaryUpstream.setFailureStatus(null);
    checks.push('circuit_open_primary_is_skipped_without_reassigning_user');

    const residualBeforeCleanup = await countResidual();
    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          requestIds,
          assignments: {
            userA: assignmentA1.upstreamProvider.name,
            userB: assignmentB.upstreamProvider.name
          },
          upstreams: [
            {
              label: upstreamA.label,
              requests: upstreamA.getRequestCount(),
              maxConcurrent: upstreamA.getMaxConcurrent()
            },
            {
              label: upstreamB.label,
              requests: upstreamB.getRequestCount(),
              maxConcurrent: upstreamB.getMaxConcurrent()
            }
          ],
          providerCounts,
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    upstreamA.close();
    upstreamB.close();
    await cleanup();
    const residualAfterCleanup = await countResidual();
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function register(username: string) {
  const result = await request<RegisterResponse>('POST', '/auth/register', { username, password });
  assert(result.status === 200 || result.status === 201, `register ${username} failed with ${result.status}: ${result.text}`);
  assert(result.cookie, `register ${username} did not return session cookie`);
  return { ...result.json, cookie: result.cookie };
}

async function getUser(username: string) {
  return prisma.user.findUniqueOrThrow({
    where: { username },
    include: { group: true }
  });
}

async function createToken(cookie: string, name: string) {
  const response = await request<TokenResponse>(
    'POST',
    '/tokens',
    {
      name,
      modelNames: [publicModel]
    },
    cookie
  );
  assert(response.status === 200 || response.status === 201, `create token ${name} failed with ${response.status}: ${response.text}`);
  assert(response.json.apiKey, `create token ${name} missing apiKey`);
  return response.json;
}

async function seedModelAndTwoUpstreams(
  createdByAdminId: string,
  groupIds: string[],
  upstreamA: TemporaryUpstream,
  upstreamB: TemporaryUpstream
) {
  const modelPrice = await prisma.modelPrice.create({
    data: {
      model: publicModel,
      displayName: publicModel,
      inputPriceCentsPer1k: 10,
      outputPriceCentsPer1k: 10,
      modelMultiplier: '1.0',
      status: ModelStatus.ACTIVE
    }
  });

  await prisma.modelGroupAccess.createMany({
    data: [...new Set(groupIds)].map((groupId) => ({
      modelPriceId: modelPrice.id,
      groupId
    })),
    skipDuplicates: true
  });

  const providers = await Promise.all([
    prisma.upstreamProvider.create({
      data: {
        name: providerAName,
        kind: UpstreamProviderKind.DEEPSEEK,
        baseUrl: upstreamA.baseUrl,
        encryptedApiKey: encryptUpstreamApiKey(upstreamKeyA),
        apiKeyPreview: maskUpstreamApiKey(upstreamKeyA),
        status: UpstreamProviderStatus.ACTIVE,
        maxConcurrency: 1,
        healthStatus: UpstreamHealthStatus.HEALTHY,
        createdByAdminId
      }
    }),
    prisma.upstreamProvider.create({
      data: {
        name: providerBName,
        kind: UpstreamProviderKind.DEEPSEEK,
        baseUrl: upstreamB.baseUrl,
        encryptedApiKey: encryptUpstreamApiKey(upstreamKeyB),
        apiKeyPreview: maskUpstreamApiKey(upstreamKeyB),
        status: UpstreamProviderStatus.ACTIVE,
        maxConcurrency: 1,
        healthStatus: UpstreamHealthStatus.HEALTHY,
        createdByAdminId
      }
    })
  ]);

  await prisma.upstreamModel.createMany({
    data: providers.map((provider) => ({
      providerId: provider.id,
      publicModel,
      upstreamModel,
      priority: 1,
      timeoutMs: 5000,
      status: ModelStatus.ACTIVE,
      supportsStream: false
    }))
  });
}

async function getAssignment(userId: string) {
  return prisma.userUpstreamAssignment.findUnique({
    where: {
      userId_publicModel: {
        userId,
        publicModel
      }
    },
    include: {
      upstreamProvider: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });
}

async function getRequestLog(requestId: string) {
  return prisma.requestLog.findUnique({
    where: { requestId }
  });
}

async function relayChat(apiKey: string, content: string) {
  return request(
    'POST',
    '/v1/chat/completions',
    {
      model: publicModel,
      messages: [{ role: 'user', content }]
    },
    undefined,
    apiKey
  );
}

async function request<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
  bearerApiKey?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(bearerApiKey ? { authorization: `Bearer ${bearerApiKey}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);
  const setCookie = response.headers.get('set-cookie')?.split(';')[0];
  return { status: response.status, headers: response.headers, text, json, cookie: setCookie };
}

async function startTemporaryUpstream(label: string, expectedKey: string): Promise<TemporaryUpstream> {
  let requestCount = 0;
  let activeCount = 0;
  let maxConcurrent = 0;
  let failureStatus: number | null = null;

  const server = createServer(async (request, response) => {
    activeCount += 1;
    maxConcurrent = Math.max(maxConcurrent, activeCount);
    try {
      const counted = await handleTemporaryUpstream(request, response, label, expectedKey, () => failureStatus);
      if (counted) {
        requestCount += 1;
      }
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'temporary upstream failed' } }));
    } finally {
      activeCount -= 1;
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
  const address = server.address();
  assert(address && typeof address === 'object', 'temporary upstream did not expose a TCP port');

  return {
    label,
    baseUrl: `http://${TEMP_UPSTREAM_PUBLIC_HOST}:${address.port}`,
    close: () => server.close(),
    getRequestCount: () => requestCount,
    getMaxConcurrent: () => maxConcurrent,
    setFailureStatus: (status) => {
      failureStatus = status;
    }
  };
}

async function handleTemporaryUpstream(
  request: IncomingMessage,
  response: ServerResponse,
  label: string,
  expectedKey: string,
  getFailureStatus: () => number | null
) {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'not found' } }));
    return false;
  }

  const authorization = request.headers.authorization;
  if (authorization !== `Bearer ${expectedKey}`) {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'bad upstream key' } }));
    return true;
  }

  await readJsonBody(request);
  await delay(UPSTREAM_RESPONSE_DELAY_MS);
  const failureStatus = getFailureStatus();
  if (failureStatus !== null) {
    response.writeHead(failureStatus, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          message: `${label} forced failure`,
          type: 'upstream_error',
          code: 'forced_upstream_failure'
        }
      })
    );
    return true;
  }

  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: `chatcmpl-${label}-${suffix}`,
      object: 'chat.completion',
      model: upstreamModel,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: label },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 5,
        total_tokens: 16
      }
    })
  );
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function requireRequestId(result: HttpResult, label: string) {
  const requestId = result.headers.get('x-request-id');
  assert(requestId, `${label} response missing x-request-id`);
  return requestId;
}

function isConcurrencyLimitError(result: HttpResult<unknown>) {
  const error = result.json as { error?: { code?: string } };
  return error.error?.code === 'upstream_concurrency_exceeded';
}

function countAssignmentsByProvider(assignments: Array<Awaited<ReturnType<typeof getAssignment>>>) {
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    if (!assignment) {
      continue;
    }
    const providerName = assignment.upstreamProvider.name;
    counts.set(providerName, (counts.get(providerName) ?? 0) + 1);
  }
  return counts;
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const providerIds = (
    await prisma.upstreamProvider.findMany({
      where: { name: { startsWith: prefix } },
      select: { id: true }
    })
  ).map((provider) => provider.id);
  const tokenIds = (
    await prisma.apiToken.findMany({
      where: { userId: { in: userIds } },
      select: { id: true }
    })
  ).map((token) => token.id);
  const usageEventIds = (
    await prisma.usageEvent.findMany({
      where: {
        OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }]
      },
      select: { id: true }
    })
  ).map((event) => event.id);

  return {
    users: users.length,
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    apiTokens: tokenIds.length,
    upstreamProviders: providerIds.length,
    upstreamModels: await prisma.upstreamModel.count({ where: { OR: [{ providerId: { in: providerIds } }, { publicModel }] } }),
    assignments: await prisma.userUpstreamAssignment.count({
      where: { OR: [{ userId: { in: userIds } }, { publicModel }, { upstreamProviderId: { in: providerIds } }] }
    }),
    concurrencySlots: await prisma.upstreamConcurrencySlot.count({
      where: { OR: [{ userId: { in: userIds } }, { publicModel }, { upstreamProviderId: { in: providerIds } }] }
    }),
    usageEvents: usageEventIds.length,
    walletTransactions: await prisma.walletTransaction.count({
      where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageEventIds } }] }
    }),
    requestLogs: await prisma.requestLog.count({
      where: {
        OR: [
          { userId: { in: userIds } },
          { tokenId: { in: tokenIds } },
          { requestId: { in: requestIds } },
          { model: publicModel },
          { upstreamProviderId: { in: providerIds } }
        ]
      }
    }),
    relayRateLimitEvents: await prisma.relayRateLimitEvent.count({
      where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }] }
    }),
    modelPrices: await prisma.modelPrice.count({ where: { model: publicModel } })
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const providerIds = (
    await prisma.upstreamProvider.findMany({
      where: { name: { startsWith: prefix } },
      select: { id: true }
    })
  ).map((provider) => provider.id);
  const tokenIds = (
    await prisma.apiToken.findMany({
      where: { userId: { in: userIds } },
      select: { id: true }
    })
  ).map((token) => token.id);
  const usageEventIds = (
    await prisma.usageEvent.findMany({
      where: {
        OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }]
      },
      select: { id: true }
    })
  ).map((event) => event.id);
  const modelPriceIds = (
    await prisma.modelPrice.findMany({
      where: { model: publicModel },
      select: { id: true }
    })
  ).map((modelPrice) => modelPrice.id);

  await prisma.requestLog.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIds } },
        { requestId: { in: requestIds } },
        { model: publicModel },
        { upstreamProviderId: { in: providerIds } }
      ]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { usageEventId: { in: usageEventIds } }] }
  });
  await prisma.usageEvent.deleteMany({ where: { id: { in: usageEventIds } } });
  await prisma.relayRateLimitEvent.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { tokenId: { in: tokenIds } }, { model: publicModel }] }
  });
  await prisma.upstreamConcurrencySlot.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { publicModel }, { upstreamProviderId: { in: providerIds } }] }
  });
  await prisma.userUpstreamAssignment.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { publicModel }, { upstreamProviderId: { in: providerIds } }] }
  });
  await prisma.apiTokenModelAccess.deleteMany({
    where: { OR: [{ apiTokenId: { in: tokenIds } }, { model: publicModel }] }
  });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });
  await prisma.upstreamModel.deleteMany({
    where: { OR: [{ providerId: { in: providerIds } }, { publicModel }] }
  });
  await prisma.modelGroupAccess.deleteMany({ where: { modelPriceId: { in: modelPriceIds } } });
  await prisma.modelPrice.deleteMany({ where: { model: publicModel } });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
