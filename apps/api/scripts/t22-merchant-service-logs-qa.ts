import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import {
  AsyncTaskKind,
  AsyncTaskStatus,
  PrismaClient,
  UserRole,
  UserStatus
} from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  cookie: string;
};

type SeededContext = {
  usernames: {
    admin: string;
    user: string;
  };
  userIds: {
    admin: string;
    user: string;
  };
  tokenId: string;
  requestId: string;
  imageTaskId: string;
  genericTaskId: string;
  imageExternalTaskId: string;
  genericExternalTaskId: string;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type AdminRequestLogsResponse = {
  items: Array<{
    requestId: string;
    user: { username: string } | null;
    token: { keyPreview: string } | null;
    model: string | null;
  }>;
  summary: {
    total: number;
    successCount: number;
    errorCount: number;
  };
};

type AdminImageTasksResponse = {
  items: Array<{
    externalTaskId: string;
    kind: string;
    user: { username: string };
    model: string | null;
  }>;
  summary: {
    total: number;
  };
  capabilities: {
    imageSubmissionSupported: boolean;
    statusSyncSupported: boolean;
  };
};

type ResidualCounts = {
  users: number;
  wallets: number;
  sessions: number;
  apiTokens: number;
  requestLogs: number;
  asyncTasks: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant service/logs QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const usernamePrefix = `q22m8_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];

let checksError: unknown;
let residualBefore: ResidualCounts | null = null;
let residualAfter: ResidualCounts | null = null;

async function main() {
  let seeded: SeededContext | null = null;
  let merchantCookie = '';
  let userCookie = '';

  try {
    seeded = await seedFixture();
    checks.push('seeded_admin_user_request_log_image_and_generic_task_records');

    const merchantLogin = await login(seeded.usernames.admin);
    assert(merchantLogin.status === 200 || merchantLogin.status === 201, `admin login failed with ${merchantLogin.status}`);
    assert(merchantLogin.cookie.length > 0, 'admin login should return session cookie');
    assert(merchantLogin.json.user.role.toLowerCase() === UserRole.ADMIN.toLowerCase(), 'admin login should return admin role');
    merchantCookie = merchantLogin.cookie;
    checks.push('merchant_login_uses_real_http_session');

    const userLogin = await login(seeded.usernames.user);
    assert(userLogin.status === 200 || userLogin.status === 201, `ordinary user login failed with ${userLogin.status}`);
    assert(userLogin.cookie.length > 0, 'ordinary user login should return session cookie');
    userCookie = userLogin.cookie;
    checks.push('ordinary_login_uses_real_http_session');

    await assertMerchantPageAccess('/merchant/request-logs', merchantCookie, userCookie, [
      'merchant-shell-page',
      '请求日志',
      '请求明细'
    ]);
    const noCookieDrawingLogsPage = await getWebPage('/merchant/drawing-logs');
    assertRedirect(noCookieDrawingLogsPage, '/login', 'unauthenticated removed merchant drawing logs page');
    const ordinaryDrawingLogsPage = await getWebPage('/merchant/drawing-logs', userCookie);
    assertRedirect(ordinaryDrawingLogsPage, '/account/profile', 'ordinary user removed merchant drawing logs page');
    const merchantDrawingLogsPage = await getWebPage('/merchant/drawing-logs', merchantCookie);
    assertRedirect(merchantDrawingLogsPage, '/merchant', 'merchant removed merchant drawing logs page');
    checks.push('merchant_request_page_renders_and_removed_drawing_page_redirects');

    const userAdminRequestLogs = await get('/admin/request-logs?limit=20', userCookie);
    assert(userAdminRequestLogs.status === 403, `ordinary user reading admin request logs should be 403, got ${userAdminRequestLogs.status}`);
    const userAdminImageTasks = await get('/admin/image-tasks?limit=20', userCookie);
    assert(userAdminImageTasks.status === 403, `ordinary user reading admin image tasks should be 403, got ${userAdminImageTasks.status}`);
    checks.push('ordinary_user_is_forbidden_from_merchant_log_admin_endpoints');

    const requestLogs = await get<AdminRequestLogsResponse>('/admin/request-logs?limit=50', merchantCookie);
    assert(requestLogs.status === 200, `admin request logs failed with ${requestLogs.status}`);
    const requestRow = requestLogs.json.items.find((entry) => entry.requestId === seeded?.requestId);
    assert(requestRow, 'admin request logs should include the seeded real request log');
    assert(requestRow.user?.username === seeded.usernames.user, 'request log user mismatch');
    assert(requestRow.token?.keyPreview === 'sk-qa-preview', 'request log token preview mismatch');
    assert(requestLogs.json.summary.total >= 1, 'request log summary should count real rows');
    checks.push('merchant_request_logs_read_real_request_log_rows');

    const imageTasks = await get<AdminImageTasksResponse>('/admin/image-tasks?limit=50', merchantCookie);
    assert(imageTasks.status === 200, `admin image tasks failed with ${imageTasks.status}`);
    const imageText = JSON.stringify(imageTasks.json);
    assert(imageText.includes(seeded.imageExternalTaskId), 'image task list should include real image task');
    assert(!imageText.includes(seeded.genericExternalTaskId), 'image task list leaked generic async task');
    assert(imageTasks.json.items.every((entry) => entry.kind === 'image'), 'image task list should only include image kind');
    assert(imageTasks.json.capabilities.imageSubmissionSupported === false, 'image submission capability should remain false until real upstream is connected');
    checks.push('merchant_image_task_api_retains_only_real_image_kind_rows');

    const userImageTasks = await get<AdminImageTasksResponse>('/async-tasks?kind=image&limit=50', userCookie);
    assert(userImageTasks.status === 200, `user image tasks failed with ${userImageTasks.status}`);
    const userImageText = JSON.stringify(userImageTasks.json);
    assert(userImageText.includes(seeded.imageExternalTaskId), 'user image logs should include own image task');
    assert(!userImageText.includes(seeded.genericExternalTaskId), 'user image logs leaked generic task');
    checks.push('ordinary_user_image_task_api_scope_remains_compatible');

    const userLogPage = await getWebPage('/log', userCookie);
    assert(userLogPage.status === 200, `ordinary user log page should render, got ${userLogPage.status}`);
    checks.push('ordinary_user_log_page_still_renders');

    residualBefore = await countResidual();
    assert(residualBefore.users >= 2, `expected seeded users before cleanup, got ${residualBefore.users}`);
    assert(residualBefore.requestLogs >= 1, `expected seeded request logs before cleanup, got ${residualBefore.requestLogs}`);
    assert(residualBefore.asyncTasks >= 2, `expected seeded async task records before cleanup, got ${residualBefore.asyncTasks}`);
    checks.push('residual_metrics_captured_before_cleanup');
  } catch (error) {
    checksError = error;
  } finally {
    if (seeded) {
      await cleanup(seeded);
    } else {
      await cleanup();
    }
    residualAfter = await countResidual();
    await prisma.$disconnect();
  }

  assertResidualZero(residualAfter);
  const result = {
    ok: checksError === undefined,
    checks,
    usernamePrefix,
    residualBefore,
    residualAfter
  };
  console.log(JSON.stringify(result, null, 2));

  if (checksError !== undefined) {
    throw checksError;
  }
}

async function seedFixture(): Promise<SeededContext> {
  const adminUsername = `${usernamePrefix}_admin`;
  const userUsername = `${usernamePrefix}_user`;
  const passwordHash = await bcryptHash(password, 12);
  const requestId = `${usernamePrefix}_request`;
  const imageExternalTaskId = `${usernamePrefix}_image_task`;
  const genericExternalTaskId = `${usernamePrefix}_generic_task`;

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: '默认分组'
      }
    });

    const admin = await tx.user.create({
      data: {
        username: adminUsername,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_admin_invite`
      }
    });

    const user = await tx.user.create({
      data: {
        username: userUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${usernamePrefix}_user_invite`
      }
    });

    await tx.wallet.createMany({
      data: [{ userId: admin.id }, { userId: user.id }]
    });

    const token = await tx.apiToken.create({
      data: {
        userId: user.id,
        name: `${usernamePrefix}_token`,
        tokenHash: `${usernamePrefix}_token_hash`,
        keyPreview: 'sk-qa-preview'
      }
    });

    await tx.requestLog.create({
      data: {
        requestId,
        userId: user.id,
        tokenId: token.id,
        method: 'POST',
        path: '/v1/chat/completions',
        model: `${usernamePrefix}_model`,
        statusCode: 200,
        latencyMs: 123,
        upstreamLatencyMs: 88,
        upstreamStatusCode: 200,
        upstreamStatus: 'ok',
        completedAt: new Date()
      }
    });

    const imageTask = await tx.asyncTask.create({
      data: {
        userId: user.id,
        externalTaskId: imageExternalTaskId,
        platform: `${usernamePrefix}_image_platform`,
        kind: AsyncTaskKind.IMAGE,
        status: AsyncTaskStatus.SUCCEEDED,
        model: `${usernamePrefix}_image_model`,
        prompt: `${usernamePrefix} image prompt`,
        progress: 100,
        resultJson: { url: `https://example.com/${usernamePrefix}.png` },
        completedAt: new Date()
      }
    });

    const genericTask = await tx.asyncTask.create({
      data: {
        userId: user.id,
        externalTaskId: genericExternalTaskId,
        platform: `${usernamePrefix}_generic_platform`,
        kind: AsyncTaskKind.GENERIC,
        status: AsyncTaskStatus.SUCCEEDED,
        model: `${usernamePrefix}_generic_model`,
        prompt: `${usernamePrefix} generic prompt`,
        progress: 100,
        resultJson: { ok: true },
        completedAt: new Date()
      }
    });

    return {
      usernames: {
        admin: adminUsername,
        user: userUsername
      },
      userIds: {
        admin: admin.id,
        user: user.id
      },
      tokenId: token.id,
      requestId,
      imageTaskId: imageTask.id,
      genericTaskId: genericTask.id,
      imageExternalTaskId,
      genericExternalTaskId
    };
  });
}

async function login(username: string) {
  return request<LoginResponse>('POST', '/auth/login', { username, password });
}

function get<T = unknown>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

async function request<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T) : ({} as T);

  return {
    status: response.status,
    json,
    text,
    cookie: extractSessionCookie(response)
  };
}

async function getWebPage(path: string, cookie?: string) {
  const response = await fetch(`${WEB_BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'manual'
  });

  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location') ?? ''
  };
}

async function assertMerchantPageAccess(path: string, merchantCookie: string, userCookie: string, markers: string[]) {
  const noCookiePage = await getWebPage(path);
  assertRedirect(noCookiePage, '/login', `unauthenticated ${path}`);

  const ordinaryPage = await getWebPage(path, userCookie);
  assertRedirect(ordinaryPage, '/account/profile', `ordinary user ${path}`);

  const merchantPage = await getWebPage(path, merchantCookie);
  assert(merchantPage.status >= 200 && merchantPage.status < 300, `merchant ${path} should render, got ${merchantPage.status}`);
  const found = markers.filter((marker) => merchantPage.text.includes(marker)).length;
  assert(found >= markers.length - 1, `merchant ${path} missing expected markers, found ${found}`);
}

function extractSessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headers.getSetCookie ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((header) => header.split(';')[0])
    .join('; ');
}

function assertRedirect(response: { status: number; location: string }, expectedPath: string, label: string) {
  assert(response.status >= 300 && response.status < 400, `${label} should redirect, got ${response.status}`);
  assert(
    response.location === expectedPath || response.location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${response.location || '<empty>'}`
  );
}

async function countResidual(): Promise<ResidualCounts> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: usernamePrefix } },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);
  const requestIds = [`${usernamePrefix}_request`];
  const taskIds = [`${usernamePrefix}_image_task`, `${usernamePrefix}_generic_task`];

  return {
    users: users.length,
    wallets: userIds.length ? await prisma.wallet.count({ where: { userId: { in: userIds } } }) : 0,
    sessions: userIds.length ? await prisma.session.count({ where: { userId: { in: userIds } } }) : 0,
    apiTokens: userIds.length ? await prisma.apiToken.count({ where: { userId: { in: userIds } } }) : 0,
    requestLogs: await prisma.requestLog.count({ where: { requestId: { in: requestIds } } }),
    asyncTasks: await prisma.asyncTask.count({ where: { externalTaskId: { in: taskIds } } })
  };
}

async function cleanup(seeded?: SeededContext) {
  const userIds = seeded ? [seeded.userIds.admin, seeded.userIds.user] : [];
  const requestIds = seeded ? [seeded.requestId] : [`${usernamePrefix}_request`];
  const taskIds = seeded ? [seeded.imageTaskId, seeded.genericTaskId] : [];

  await prisma.requestLog.deleteMany({
    where: {
      OR: [
        { requestId: { in: requestIds } },
        { userId: { in: userIds } }
      ]
    }
  });
  await prisma.asyncTask.deleteMany({
    where: {
      OR: [
        { id: { in: taskIds } },
        { externalTaskId: { startsWith: usernamePrefix } },
        { userId: { in: userIds } }
      ]
    }
  });
  await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function assertResidualZero(result: ResidualCounts | null) {
  if (!result) {
    return;
  }

  assert(result.users === 0, `residual users should be 0, got ${result.users}`);
  assert(result.wallets === 0, `residual wallets should be 0, got ${result.wallets}`);
  assert(result.sessions === 0, `residual sessions should be 0, got ${result.sessions}`);
  assert(result.apiTokens === 0, `residual apiTokens should be 0, got ${result.apiTokens}`);
  assert(result.requestLogs === 0, `residual requestLogs should be 0, got ${result.requestLogs}`);
  assert(result.asyncTasks === 0, `residual asyncTasks should be 0, got ${result.asyncTasks}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
