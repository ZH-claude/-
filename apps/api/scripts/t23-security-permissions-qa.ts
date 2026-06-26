import { PrismaPg } from '@prisma/adapter-pg';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  cookie?: string;
};

type RegisterResponse = {
  user: {
    id: string;
    username: string;
  };
};

type RechargeCodeCreateResponse = {
  items?: Array<{
    id?: string;
    code?: string;
  }>;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const UPSTREAM_SECRET = process.env.UPSTREAM_KEY_ENCRYPTION_SECRET;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run T23 security permissions QA');
}

if (!UPSTREAM_SECRET || UPSTREAM_SECRET.length < 32) {
  throw new Error('UPSTREAM_KEY_ENCRYPTION_SECRET must be set to at least 32 characters');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const prefix = `qa_t23_m05_${suffix}`;
const password = `qa-password-${suffix}`;
const upstreamApiKey = `t23-upstream-secret-${suffix}-must-not-leak`;
const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.cwd(),
  encoding: 'utf8'
}).trim();
const checks: string[] = [];
const sensitiveValues = new Set<string>();

const adminReadRoutes = [
  '/admin/dashboard-summary',
  '/admin/daily-consumption-report?days=7',
  '/admin/users?limit=5',
  '/admin/audit-logs?limit=20',
  '/admin/security-audit-logs?limit=20',
  '/admin/request-logs?limit=20',
  '/admin/image-tasks?limit=20',
  '/admin/upstreams',
  '/admin/model-config',
  '/admin/groups',
  '/admin/announcements',
  '/admin/translation-glossary',
  '/admin/recharge-codes',
  '/admin/payment-orders',
  '/admin/site-content',
  '/admin/ai-recharge/page-config',
  '/admin/ai-recharge/products',
  '/admin/ai-recharge/orders'
];

const adminWriteRoutes: Array<{ path: string; body: Record<string, unknown> }> = [
  {
    path: '/admin/announcements',
    body: { title: `${prefix}_blocked`, content: 'blocked', status: 'draft' }
  },
  {
    path: '/admin/upstreams',
    body: { name: `${prefix}_blocked_upstream`, baseUrl: 'https://example.invalid/v1', apiKey: upstreamApiKey }
  },
  {
    path: '/admin/recharge-codes',
    body: { amountCnyCents: 100, count: 1 }
  },
  {
    path: '/admin/translation-glossary',
    body: { sourceTerm: `${prefix}_blocked_term`, replacementTerm: 'blocked' }
  },
  {
    path: '/admin/site-content',
    body: { homeTitle: `${prefix}_blocked_home` }
  },
  {
    path: '/admin/ai-recharge/page-config',
    body: { introTitle: `${prefix}_blocked_intro` }
  },
  {
    path: '/admin/ai-recharge/products',
    body: {
      title: `${prefix}_blocked_product`,
      platform: 'QA',
      planName: 'Blocked',
      durationDays: 7,
      priceCnyCents: 100,
      description: 'blocked',
      sortOrder: 100,
      status: 'active'
    }
  }
];

const userReadRoutes = [
  '/auth/me',
  '/usage/logs?limit=5',
  '/usage/token-leaderboard?period=all&limit=5',
  '/recharge/records',
  '/recharge/payments/orders',
  '/ai-recharge/page-config',
  '/ai-recharge/products',
  '/ai-recharge/orders'
];

async function main() {
  let adminUserId: string | null = null;
  let userId: string | null = null;
  let createdUpstreamId: string | null = null;
  let createdRechargeCodeId: string | null = null;

  try {
    verifyTrackedRepositorySecretBoundaries();

    const admin = await register(`${prefix}_admin`);
    const user = await register(`${prefix}_user`);
    adminUserId = admin.userId;
    userId = user.userId;
    await prisma.user.update({ where: { id: admin.userId }, data: { role: UserRole.ADMIN } });
    checks.push('setup_created_admin_and_ordinary_user_sessions');

    sensitiveValues.add(password);
    sensitiveValues.add(upstreamApiKey);
    sensitiveValues.add(admin.cookie);
    sensitiveValues.add(user.cookie);

    const upstream = await post<{ id?: string }>(
      '/admin/upstreams',
      {
        name: `${prefix}_upstream`,
        baseUrl: 'https://example.invalid/v1',
        apiKey: upstreamApiKey,
        status: 'active',
        maxConcurrency: 3
      },
      admin.cookie
    );
    assert(upstream.status === 200 || upstream.status === 201, `admin upstream create failed with ${upstream.status}: ${upstream.text}`);
    assertNoSensitiveLeak('admin upstream create response', upstream.json, upstream.text);
    createdUpstreamId = typeof upstream.json.id === 'string' ? upstream.json.id : null;
    checks.push('admin_can_seed_upstream_without_leaking_plain_or_encrypted_key');

    const recharge = await post<RechargeCodeCreateResponse>(
      '/admin/recharge-codes',
      { amountCnyCents: 123, count: 1 },
      admin.cookie
    );
    assert(recharge.status === 200 || recharge.status === 201, `admin recharge code create failed with ${recharge.status}: ${recharge.text}`);
    const oneTimeCode = recharge.json.items?.[0]?.code;
    assert(typeof oneTimeCode === 'string' && oneTimeCode.length > 0, 'admin recharge code create should return one-time plaintext code');
    assert(!recharge.text.includes('codeHash'), 'one-time recharge code create response must not expose codeHash');
    createdRechargeCodeId = recharge.json.items?.[0]?.id ?? null;
    sensitiveValues.add(oneTimeCode);
    checks.push('admin_can_seed_one_time_recharge_code_without_code_hash');

    const glossary = await post(
      '/admin/translation-glossary',
      { sourceTerm: `${prefix}_Azure Planet Relay`, replacementTerm: 'Azure Planet Relay', note: 'T23 M05 QA' },
      admin.cookie
    );
    assert(glossary.status === 200 || glossary.status === 201, `admin translation glossary create failed with ${glossary.status}: ${glossary.text}`);
    assertNoSensitiveLeak('admin glossary create response', glossary.json, glossary.text);
    checks.push('admin_can_seed_translation_glossary_without_sensitive_payload');

    await verifyAdminReadMatrix(admin.cookie, user.cookie);
    await verifyAdminWriteMatrix(user.cookie);
    await verifyUserSurfaceMatrix(user.cookie);
    await verifyResidualBeforeCleanup(adminUserId, userId, createdUpstreamId, createdRechargeCodeId);

    console.log(JSON.stringify({ ok: true, suffix, checks }, null, 2));
  } finally {
    await cleanup();
    const residualAfterCleanup = await countResidual();
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    assertResidualZero(residualAfterCleanup, 'cleanup residual');
    await prisma.$disconnect();
  }
}

function verifyTrackedRepositorySecretBoundaries() {
  const trackedFiles = execGitLines(['ls-files']);
  const trackedRuntimeEnvFiles = trackedFiles.filter((file) => {
    const normalized = file.replace(/\\/g, '/');
    const fileName = normalized.split('/').pop() ?? normalized;
    if (normalized === '.env.example') {
      return false;
    }
    return fileName === '.env' || fileName.startsWith('.env.') || fileName.endsWith('.env');
  });
  assert(
    trackedRuntimeEnvFiles.length === 0,
    `tracked runtime env files are forbidden: ${trackedRuntimeEnvFiles.join(', ')}`
  );

  const highRiskSecretPatterns = [
    { label: 'private key material', pattern: '-----BEGIN (RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----' },
    { label: 'aws access key', pattern: 'AKIA[0-9A-Z]{16}' },
    { label: 'openai-style api key', pattern: 'sk-[A-Za-z0-9_-]{40,}' },
    { label: 'github access token', pattern: 'gh[pousr]_[A-Za-z0-9]{36,}' },
    { label: 'google api key', pattern: 'AIza[0-9A-Za-z_-]{35}' },
    { label: 'slack token', pattern: 'xox[baprs]-[A-Za-z0-9-]{20,}' }
  ];
  const secretMatches = highRiskSecretPatterns.flatMap(({ label, pattern }) =>
    execGitGrep(pattern).map((match) => `${label}: ${match}`)
  );
  assert(secretMatches.length === 0, `tracked repository files contain high-risk secret material: ${secretMatches.join('; ')}`);

  checks.push('repository_tracked_files_exclude_runtime_env_and_high_risk_secrets');
}

function execGitLines(args: string[]) {
  const output = execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  return output.split(/\r?\n/).filter(Boolean);
}

function execGitGrep(pattern: string) {
  try {
    return execGitLines(['grep', '-n', '-I', '-E', '-e', pattern, '--', '.', ':!.env.example']);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) {
      return [];
    }
    throw error;
  }
}

async function verifyAdminReadMatrix(adminCookie: string, userCookie: string) {
  for (const path of adminReadRoutes) {
    const unauthenticated = await get(path);
    assert(unauthenticated.status === 401, `${path} should return 401 without session, got ${unauthenticated.status}`);

    const ordinaryUser = await get(path, userCookie);
    assert(ordinaryUser.status === 403, `${path} should return 403 for ordinary user, got ${ordinaryUser.status}`);

    const admin = await get(path, adminCookie);
    assert(admin.status === 200, `${path} should return 200 for admin, got ${admin.status}: ${admin.text}`);
    assertNoSensitiveLeak(`admin read ${path}`, admin.json, admin.text);
  }

  checks.push('admin_read_routes_enforce_401_403_200_matrix_without_sensitive_leaks');
}

async function verifyAdminWriteMatrix(userCookie: string) {
  for (const route of adminWriteRoutes) {
    const unauthenticated = await post(route.path, route.body);
    assert(unauthenticated.status === 401, `${route.path} write should return 401 without session, got ${unauthenticated.status}`);

    const ordinaryUser = await post(route.path, route.body, userCookie);
    assert(ordinaryUser.status === 403, `${route.path} write should return 403 for ordinary user, got ${ordinaryUser.status}`);
  }

  checks.push('admin_write_routes_reject_unauthenticated_and_ordinary_users_before_mutation');
}

async function verifyUserSurfaceMatrix(userCookie: string) {
  for (const path of userReadRoutes) {
    const unauthenticated = await get(path);
    assert(unauthenticated.status === 401, `${path} should return 401 without session, got ${unauthenticated.status}`);

    const user = await get(path, userCookie);
    assert(user.status === 200, `${path} should return 200 for authenticated user, got ${user.status}: ${user.text}`);
    assertNoSensitiveLeak(`user read ${path}`, user.json, user.text);
  }

  checks.push('user_console_routes_require_session_and_do_not_leak_sensitive_fields');
}

async function verifyResidualBeforeCleanup(
  adminUserId: string | null,
  userId: string | null,
  upstreamId: string | null,
  rechargeCodeId: string | null
) {
  const residual = await countResidual();
  assert(residual.users === 2, `expected 2 seeded users before cleanup, got ${residual.users}`);
  assert(residual.sessions >= 2, `expected seeded sessions before cleanup, got ${residual.sessions}`);
  assert(residual.wallets === 2, `expected 2 seeded wallets before cleanup, got ${residual.wallets}`);
  assert(residual.upstreamProviders >= 1 || Boolean(upstreamId), 'expected seeded upstream provider before cleanup');
  assert(residual.rechargeCodes >= 1 || Boolean(rechargeCodeId), 'expected seeded recharge code before cleanup');
  assert(Boolean(adminUserId) && Boolean(userId), 'seeded user ids should be captured before cleanup');
  checks.push('seeded_security_permission_fixture_is_visible_before_cleanup');
}

async function register(username: string) {
  const result = await post<RegisterResponse>('/auth/register', { username, password });
  assert(result.status === 200 || result.status === 201, `register ${username} failed with ${result.status}: ${result.text}`);
  assert(result.cookie, `register ${username} did not return session cookie`);
  return {
    userId: result.json.user.id,
    username: result.json.user.username,
    cookie: result.cookie
  };
}

async function get<T = unknown>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

async function post<T = unknown>(path: string, body?: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function request<T = unknown>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let json: T;
  try {
    json = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    json = {} as T;
  }

  return {
    status: response.status,
    json,
    text,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

function assertNoSensitiveLeak(context: string, payload: unknown, text: string) {
  const leakedFields = collectSensitiveFieldNames(payload);
  assert(leakedFields.length === 0, `${context} leaked sensitive fields: ${leakedFields.join(', ')}`);

  for (const value of sensitiveValues) {
    if (value && text.includes(value)) {
      throw new Error(`${context} leaked sensitive value: ${redact(value)}`);
    }
  }

  const forbiddenPatterns = [
    /postgres(?:ql)?:\/\//i,
    /\bDATABASE_URL\b/i,
    /\bUPSTREAM_KEY_ENCRYPTION_SECRET\b/i,
    /\bPASSWORD_RECOVERY_CODE_SECRET\b/i,
    /\b[A-Za-z0-9_]*tokenHash[A-Za-z0-9_]*\b/,
    /\b[A-Za-z0-9_]*passwordHash[A-Za-z0-9_]*\b/,
    /\b[A-Za-z0-9_]*encryptedApiKey[A-Za-z0-9_]*\b/,
    /\b[A-Za-z0-9_]*codeHash[A-Za-z0-9_]*\b/,
    /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{12,}\b/
  ];

  for (const pattern of forbiddenPatterns) {
    const match = text.match(pattern);
    assert(!match, `${context} leaked forbidden secret pattern: ${match?.[0] ?? pattern.toString()}`);
  }
}

function collectSensitiveFieldNames(payload: unknown, path = '$'): string[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((item, index) => collectSensitiveFieldNames(item, `${path}[${index}]`));
  }

  const forbiddenKeys = new Set([
    'passwordHash',
    'tokenHash',
    'codeHash',
    'encryptedApiKey',
    'encryptedTarget',
    'phoneDigest',
    'providerPayload'
  ]);
  const leaks: string[] = [];

  for (const [key, value] of Object.entries(payload)) {
    if (forbiddenKeys.has(key)) {
      leaks.push(`${path}.${key}`);
      continue;
    }
    leaks.push(...collectSensitiveFieldNames(value, `${path}.${key}`));
  }

  return leaks;
}

function redact(value: string) {
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);

  const rechargeCodes = await prisma.rechargeCode.findMany({
    where: { OR: [{ createdByAdminId: { in: userIds } }, { usedByUserId: { in: userIds } }] },
    select: { id: true }
  });
  const rechargeCodeIds = rechargeCodes.map((code) => code.id);

  const aiProducts = await prisma.aiRechargeProduct.findMany({
    where: { OR: [{ createdByAdminId: { in: userIds } }, { title: { startsWith: prefix } }] },
    select: { id: true }
  });
  const aiProductIds = aiProducts.map((product) => product.id);

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: [...providerIds, ...rechargeCodeIds, ...aiProductIds] } }
      ]
    }
  });
  await prisma.securityAuditLog.deleteMany({
    where: {
      OR: [
        { actorUserId: { in: userIds } },
        { targetId: { in: userIds } }
      ]
    }
  });
  await prisma.aiRechargeOrder.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { productId: { in: aiProductIds } }] }
  });
  await prisma.aiRechargeProduct.deleteMany({
    where: { OR: [{ id: { in: aiProductIds } }, { createdByAdminId: { in: userIds } }, { title: { startsWith: prefix } }] }
  });
  await prisma.translationGlossaryTerm.deleteMany({
    where: { OR: [{ sourceTerm: { startsWith: prefix } }, { replacementTerm: { startsWith: prefix } }] }
  });
  await prisma.announcement.deleteMany({
    where: { OR: [{ createdByAdminId: { in: userIds } }, { title: { startsWith: prefix } }] }
  });
  await prisma.upstreamConcurrencySlot.deleteMany({ where: { upstreamProviderId: { in: providerIds } } });
  await prisma.userUpstreamAssignment.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { upstreamProviderId: { in: providerIds } }] } });
  await prisma.upstreamModel.deleteMany({ where: { providerId: { in: providerIds } } });
  await prisma.requestLog.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { upstreamProviderId: { in: providerIds } }] } });
  await prisma.usageEvent.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { upstreamProviderId: { in: providerIds } }] } });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });
  await prisma.walletTransaction.deleteMany({
    where: { OR: [{ userId: { in: userIds } }, { rechargeCodeId: { in: rechargeCodeIds } }] }
  });
  await prisma.rechargeCode.deleteMany({
    where: { OR: [{ id: { in: rechargeCodeIds } }, { createdByAdminId: { in: userIds } }, { usedByUserId: { in: userIds } }] }
  });
  await prisma.passwordRecoveryCode.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.relayRateLimitEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.apiTokenModelAccess.deleteMany({ where: { apiToken: { userId: { in: userIds } } } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
  const rechargeCodes = await prisma.rechargeCode.findMany({
    where: { OR: [{ createdByAdminId: { in: userIds } }, { usedByUserId: { in: userIds } }] },
    select: { id: true }
  });
  const rechargeCodeIds = rechargeCodes.map((code) => code.id);
  const aiProducts = await prisma.aiRechargeProduct.findMany({
    where: { OR: [{ createdByAdminId: { in: userIds } }, { title: { startsWith: prefix } }] },
    select: { id: true }
  });
  const aiProductIds = aiProducts.map((product) => product.id);

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    wallets: await prisma.wallet.count({ where: { userId: { in: userIds } } }),
    upstreamProviders: providerIds.length,
    upstreamModels: await prisma.upstreamModel.count({ where: { providerId: { in: providerIds } } }),
    upstreamSlots: await prisma.upstreamConcurrencySlot.count({ where: { upstreamProviderId: { in: providerIds } } }),
    userUpstreamAssignments: await prisma.userUpstreamAssignment.count({
      where: { OR: [{ userId: { in: userIds } }, { upstreamProviderId: { in: providerIds } }] }
    }),
    rechargeCodes: rechargeCodeIds.length,
    aiProducts: aiProductIds.length,
    aiOrders: await prisma.aiRechargeOrder.count({ where: { OR: [{ userId: { in: userIds } }, { productId: { in: aiProductIds } }] } }),
    announcements: await prisma.announcement.count({ where: { OR: [{ createdByAdminId: { in: userIds } }, { title: { startsWith: prefix } }] } }),
    translationGlossaryTerms: await prisma.translationGlossaryTerm.count({ where: { sourceTerm: { startsWith: prefix } } }),
    adminAuditLogs: await prisma.adminAuditLog.count({
      where: {
        OR: [
          { adminUserId: { in: userIds } },
          { targetId: { in: [...providerIds, ...rechargeCodeIds, ...aiProductIds] } }
        ]
      }
    }),
    securityAuditLogs: await prisma.securityAuditLog.count({
      where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: userIds } }] }
    })
  };
}

function assertResidualZero(residual: Record<string, number>, label: string) {
  const nonZero = Object.entries(residual).filter(([, count]) => count !== 0);
  assert(nonZero.length === 0, `${label} should be zero, got ${JSON.stringify(Object.fromEntries(nonZero))}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exit(1);
});
