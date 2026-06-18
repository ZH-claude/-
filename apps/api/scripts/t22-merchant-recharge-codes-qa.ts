import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, PrismaClient, RechargeCodeStatus, UserRole, UserStatus } from '../src/generated/prisma/client';

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
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type CreateResponse = {
  items: Array<{
    id: string;
    code: string;
    amountCents: number;
    amountBaseTokens: number;
    faceValueCnyCents: number;
    status: string;
  }>;
};

type AdminListResponse = {
  items: Array<Record<string, unknown> & { id: string; status: string; amountCents: number; amountBaseTokens: number; faceValueCnyCents: number }>;
};

type RedeemResponse = {
  recharge: {
    id: string;
    amountCents: number;
    amountBaseTokens: number;
    faceValueCnyCents: number;
  };
  wallet: {
    balanceCents: number;
    balanceBaseTokens: number;
    totalSpendCents: number;
  };
};

type ResidualCounts = {
  users: number;
  wallets: number;
  sessions: number;
  rechargeCodes: number;
  walletTransactions: number;
  adminAuditLogs: number;
  securityAuditLogs: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;
const FACE_VALUE_CNY_CENTS = 800;
const EXPECTED_BASE_TOKENS = 1_000_000;
const CODE_COUNT = 2;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant recharge-code QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const usernamePrefix = `q22r_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];
const knownCodeIds: string[] = [];
const knownPlainCodes: string[] = [];

let checksError: unknown;
let residualBefore: ResidualCounts | null = null;
let residualAfter: ResidualCounts | null = null;

async function main() {
  let seeded: SeededContext | null = null;
  let merchantCookie = '';
  let userCookie = '';

  try {
    seeded = await seedFixture();
    checks.push('seeded_admin_user_and_user_with_wallets');

    const merchantLogin = await login(seeded.usernames.admin);
    assert(
      merchantLogin.status === 200 || merchantLogin.status === 201,
      `admin login failed with ${merchantLogin.status}`
    );
    assert(merchantLogin.cookie.length > 0, 'admin login should return session cookie');
    merchantCookie = merchantLogin.cookie;
    assert(merchantLogin.json.user.role.toLowerCase() === UserRole.ADMIN.toLowerCase(), 'admin login should return admin role');
    checks.push('admin_login_uses_real_http_and_session_token');

    const userLogin = await login(seeded.usernames.user);
    assert(userLogin.status === 200 || userLogin.status === 201, `ordinary user login failed with ${userLogin.status}`);
    assert(userLogin.cookie.length > 0, 'ordinary user login should return session cookie');
    userCookie = userLogin.cookie;
    checks.push('ordinary_login_uses_real_http_and_session_token');

    const noCookiePage = await getMerchantRechargeCodesPage();
    assertRedirect(noCookiePage, '/login', 'unauthenticated /merchant/recharge-codes page');

    const ordinaryPage = await getMerchantRechargeCodesPage(userCookie);
    assertRedirect(ordinaryPage, '/account/profile', 'ordinary user /merchant/recharge-codes page');

    const merchantPage = await getMerchantRechargeCodesPage(merchantCookie);
    assert(
      merchantPage.status >= 200 && merchantPage.status < 300,
      `merchant /merchant/recharge-codes page should render, got ${merchantPage.status}`
    );
    assertMerchantRechargeCodesHtml(merchantPage.text);
    checks.push('merchant_recharge_codes_page_renders_and_blocks_unauthorized_users');

    const userCreateBlocked = await post<CreateResponse>('/admin/recharge-codes', { amountCnyCents: FACE_VALUE_CNY_CENTS, count: 1 }, userCookie);
    assert(userCreateBlocked.status === 403, `ordinary user creating admin recharge code should be 403, got ${userCreateBlocked.status}`);

    const userListBlocked = await get<AdminListResponse>('/admin/recharge-codes', userCookie);
    assert(userListBlocked.status === 403, `ordinary user reading admin recharge-code list should be 403, got ${userListBlocked.status}`);
    checks.push('ordinary_user_is_forbidden_from_admin_recharge_code_endpoints');

    const created = await post<CreateResponse>('/admin/recharge-codes', { amountCnyCents: FACE_VALUE_CNY_CENTS, count: CODE_COUNT }, merchantCookie);
    assert(created.status === 200 || created.status === 201, `admin create recharge codes failed with ${created.status}`);
    assert(created.json.items.length === CODE_COUNT, `expected ${CODE_COUNT} recharge items, got ${created.json.items.length}`);

    for (const item of created.json.items) {
      assert(typeof item.code === 'string' && item.code.length > 0, `created item ${item.id} is missing plain code`);
      assert(/^(RC-[A-F0-9]{32})$/.test(item.code), `created code ${item.id} is malformed`);
      assert(item.faceValueCnyCents === FACE_VALUE_CNY_CENTS, `created code face value mismatch for ${item.id}`);
      assert(item.amountBaseTokens === EXPECTED_BASE_TOKENS, `created code base token amount mismatch for ${item.id}`);
      knownCodeIds.push(item.id);
      knownPlainCodes.push(item.code);
      const expectedHash = hashRechargeCode(item.code);
      const dbCode = await prisma.rechargeCode.findUniqueOrThrow({ where: { id: item.id } });
      assert(dbCode.codeHash === expectedHash, `hash mismatch for created code ${item.id}`);
      assert(dbCode.createdByAdminId === seeded.userIds.admin, `created code ${item.id} owner mismatch`);
      assert(dbCode.codeHash !== item.code, `stored plain code for ${item.id}`);
      assert(dbCode.faceValueCnyCents === FACE_VALUE_CNY_CENTS, `DB face value mismatch for ${item.id}`);
      assert(dbCode.amountCents === EXPECTED_BASE_TOKENS, `DB base token amount mismatch for ${item.id}`);
      assert(dbCode.status === RechargeCodeStatus.UNUSED, `new code ${item.id} should be unused`);
    }
    checks.push('admin_can_create_recharge_codes_and_only_payload_exposes_plaintext');

    for (const plainCode of knownPlainCodes) {
      assert(created.text.includes(plainCode), `admin create response missing plaintext code ${plainCode}`);
    }

    const adminList = await get<AdminListResponse>('/admin/recharge-codes', merchantCookie);
    assert(adminList.status === 200, `admin list failed with ${adminList.status}`);
    const listText = JSON.stringify(adminList.json);
    for (const id of knownCodeIds) {
      const listed = adminList.json.items.find((entry) => entry.id === id);
      assert(!!listed, `admin list should include created code ${id}`);
      assert(listed.faceValueCnyCents === FACE_VALUE_CNY_CENTS, `admin list face value mismatch for ${id}`);
      assert(listed.amountBaseTokens === EXPECTED_BASE_TOKENS, `admin list base token amount mismatch for ${id}`);
      assert(!Object.prototype.hasOwnProperty.call(listed, 'code'), `admin list leaked plaintext code for ${id}`);
      assert(!Object.prototype.hasOwnProperty.call(listed, 'codeHash'), `admin list leaked codeHash for ${id}`);
      assert(!listText.includes(`"codeHash":`), `admin list response should not include codeHash keys`);
    }
    assertNoSensitiveText(listText, ['codehash', 'tokenhash', 'passwordhash'], 'admin /admin/recharge-codes list response');
    checks.push('admin_list_does_not_leak_plaintext_code_or_hash_fields');

    for (const plainCode of knownPlainCodes) {
      assert(!adminList.text.includes(plainCode), `admin list leaked plaintext code ${plainCode}`);
    }

    const adminAudit = await get('/admin/audit-logs?limit=100', merchantCookie);
    assert(adminAudit.status === 200, `admin audit logs should return 200, got ${adminAudit.status}`);
    const adminAuditText = JSON.stringify(adminAudit.json);
    assert(adminAuditText.includes('recharge_code_created'), 'admin audit logs should include recharge_code_created');
    for (const plainCode of knownPlainCodes) {
      assert(!adminAuditText.includes(plainCode), `admin audit logs leaked plaintext code ${plainCode}`);
      assert(!adminAuditText.includes(hashRechargeCode(plainCode)), `admin audit logs leaked code hash for ${plainCode}`);
    }
    assertNoSensitiveText(adminAuditText, ['codehash', 'tokenhash', 'passwordhash'], '/admin/audit-logs response');
    checks.push('admin_audit_response_hides_recharge_plaintext_and_hashes');

    const firstCode = created.json.items[0];
    const beforeWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: seeded.userIds.user } });
    const userDisableBlocked = await post(`/admin/recharge-codes/${firstCode.id}/disable`, {}, userCookie);
    assert(userDisableBlocked.status === 403, `ordinary user disable attempt should be 403, got ${userDisableBlocked.status}`);

    const redeem = await post<RedeemResponse>('/recharge/redeem', { code: firstCode.code }, userCookie);
    assert(redeem.status === 200 || redeem.status === 201, `redeem should be successful, got ${redeem.status}`);
    assert(redeem.json.recharge.faceValueCnyCents === FACE_VALUE_CNY_CENTS, 'redeem face value mismatch');
    assert(redeem.json.recharge.amountBaseTokens === EXPECTED_BASE_TOKENS, 'redeem base token amount mismatch');
    assert(redeem.json.wallet.balanceCents === beforeWallet.balanceCents + EXPECTED_BASE_TOKENS, 'wallet balance should increase by base token amount');
    assert(
      redeem.json.wallet.balanceBaseTokens === beforeWallet.balanceCents + EXPECTED_BASE_TOKENS,
      'wallet base token balance should increase by base token amount'
    );
    assert(redeem.json.recharge.id === firstCode.id, 'redeem response should reference redeemed code id');
    const afterWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: seeded.userIds.user } });
    assert(afterWallet.balanceCents === beforeWallet.balanceCents + EXPECTED_BASE_TOKENS, 'wallet balance from DB should increase after redeem');

    const redeemedCode = await prisma.rechargeCode.findUniqueOrThrow({ where: { id: firstCode.id } });
    assert(redeemedCode.status === RechargeCodeStatus.USED, 'redeemed code should be marked used');
    assert(redeemedCode.usedByUserId === seeded.userIds.user, 'redeemed code should record usedByUserId');
    checks.push('ordinary_user_redeems_code_and_balance_code_status_updates');

    const disableUsed = await post(`/admin/recharge-codes/${firstCode.id}/disable`, {}, merchantCookie);
    assert(disableUsed.status === 409 || (disableUsed.status >= 200 && disableUsed.status < 300), 'disable used code should fail or have no effect');
    const redeemedCodeAfterDisable = await prisma.rechargeCode.findUniqueOrThrow({ where: { id: firstCode.id } });
    assert(redeemedCodeAfterDisable.status === RechargeCodeStatus.USED, 'disable used code path should not change status');
    checks.push('disabling_used_code_does_not_unduly_change_state');

    const secondCode = created.json.items[1];
    const disableUnused = await post(`/admin/recharge-codes/${secondCode.id}/disable`, {}, merchantCookie);
    assert(disableUnused.status === 200 || disableUnused.status === 201, `disable unused code should return success, got ${disableUnused.status}`);

    const disabledCode = await prisma.rechargeCode.findUniqueOrThrow({ where: { id: secondCode.id } });
    assert(disabledCode.status === RechargeCodeStatus.DISABLED, 'unused code should become disabled');

    const beforeDisabledRedeemBalance = await prisma.wallet.findUniqueOrThrow({ where: { userId: seeded.userIds.user } });
    const redeemDisabled = await post<RedeemResponse>('/recharge/redeem', { code: secondCode.code }, userCookie);
    assert(redeemDisabled.status === 400 || redeemDisabled.status === 409, `redeem disabled code should fail, got ${redeemDisabled.status}`);
    const afterDisabledRedeemBalance = await prisma.wallet.findUniqueOrThrow({ where: { userId: seeded.userIds.user } });
    assert(
      afterDisabledRedeemBalance.balanceCents === beforeDisabledRedeemBalance.balanceCents,
      'balance must not change when redeeming disabled code'
    );
    checks.push('disabled_code_cannot_be_redeemed_and_wallet_is_unchanged');

    const records = await get<{
      items: Array<{ rechargeCodeId: string | null; amountCents: number; amountBaseTokens: number; faceValueCnyCents: number | null; status: string }>;
    }>(
      '/recharge/records',
      userCookie
    );
    assert(records.status === 200, `records query should return 200, got ${records.status}`);
    const recordsText = JSON.stringify(records.json);
    assertNoSensitiveText(recordsText, ['codehash', 'tokenhash', 'passwordhash'], '/recharge/records response');
    for (const plainCode of knownPlainCodes) {
      assert(!recordsText.includes(plainCode), `recharge records leaked plaintext code ${plainCode}`);
    }
    assert(
      records.json.items.some(
        (entry) =>
          entry.rechargeCodeId === firstCode.id &&
          entry.amountBaseTokens === EXPECTED_BASE_TOKENS &&
          entry.faceValueCnyCents === FACE_VALUE_CNY_CENTS
      ),
      'recharge records should expose base token amount and RMB face value'
    );

    for (const plainCode of knownPlainCodes) {
      assert(!adminList.text.includes(plainCode), 'admin list still should not expose plaintext code after operations');
    }

    residualBefore = await countResidual();
    assert(
      residualBefore.users >= 2,
      `expected residual seed users pre-cleanup to be at least 2, got ${residualBefore.users}`
    );
    checks.push('residual_row_metrics_captured_before_cleanup');
  } catch (error) {
    checksError = error;
  } finally {
    if (seeded) {
      await cleanup(seeded.userIds.admin, seeded.userIds.user);
    } else {
      await cleanup('');
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

  return prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: 'Default Group'
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

    return {
      usernames: {
        admin: adminUsername,
        user: userUsername
      },
      userIds: {
        admin: admin.id,
        user: user.id
      }
    };
  });
}

async function login(username: string) {
  return request<LoginResponse>('POST', '/auth/login', { username, password });
}

function get<T>(path: string, cookie: string) {
  return request<T>('GET', path, undefined, cookie);
}

function post<T = unknown>(path: string, body: unknown, cookie: string) {
  return request<T>('POST', path, body, cookie);
}

async function getMerchantRechargeCodesPage(cookie?: string) {
  const response = await fetch(`${WEB_BASE_URL}/merchant/recharge-codes`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'manual'
  });

  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location') ?? ''
  };
}

function assertRedirect(response: { status: number; location: string }, expectedPath: string, label: string) {
  assert(response.status >= 300 && response.status < 400, `${label} should redirect, got ${response.status}`);
  assert(
    response.location === expectedPath || response.location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${response.location || '<empty>'}`
  );
}

function assertMerchantRechargeCodesHtml(text: string) {
  const markers = ['merchant-shell-page', '充值码管理', '生成充值码', '充值码状态'];
  const found = markers.filter((marker) => text.includes(marker)).length;
  assert(found >= 3, `merchant recharge-code page missing expected markers, found ${found}`);
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

function extractSessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookieHeaders = headers.getSetCookie ? headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  return cookieHeaders
    .filter(Boolean)
    .map((header) => header.split(';')[0])
    .join('; ');
}

function hashRechargeCode(plainCode: string) {
  return createHash('sha256').update(`recharge-code:${plainCode}`).digest('hex');
}

function assertNoSensitiveText(text: string, forbidden: string[], label: string) {
  const lowered = text.toLowerCase();
  for (const value of forbidden) {
    assert(!lowered.includes(value.toLowerCase()), `${label} leaked sensitive field/value: ${value}`);
  }
}

async function countResidual(): Promise<ResidualCounts> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: usernamePrefix } },
    select: { id: true }
  });
  const userIds = users.map((entry) => entry.id);
  const base = {
    users: users.length,
    wallets: 0,
    sessions: 0,
    rechargeCodes: 0,
    walletTransactions: 0,
    adminAuditLogs: 0,
    securityAuditLogs: 0
  };

  if (userIds.length === 0 && knownCodeIds.length === 0) {
    return base;
  }

  const rechargeCodeFilters: Prisma.RechargeCodeWhereInput[] = [];
  const walletTransactionFilters: Prisma.WalletTransactionWhereInput[] = [];
  const adminAuditFilters: Prisma.AdminAuditLogWhereInput[] = [];
  const securityAuditFilters: Prisma.SecurityAuditLogWhereInput[] = [];

  if (userIds.length > 0) {
    rechargeCodeFilters.push({ createdByAdminId: { in: userIds } }, { usedByUserId: { in: userIds } });
    walletTransactionFilters.push({ userId: { in: userIds } });
    adminAuditFilters.push({ adminUserId: { in: userIds } });
    securityAuditFilters.push({ actorUserId: { in: userIds } }, { targetId: { in: userIds } });
  }

  if (knownCodeIds.length > 0) {
    rechargeCodeFilters.push({ id: { in: knownCodeIds } });
    walletTransactionFilters.push({ rechargeCodeId: { in: knownCodeIds } });
    adminAuditFilters.push({ targetId: { in: knownCodeIds } });
    securityAuditFilters.push({ targetId: { in: knownCodeIds } });
  }

  const wallets = userIds.length ? await prisma.wallet.count({ where: { userId: { in: userIds } } }) : 0;
  const sessions = userIds.length ? await prisma.session.count({ where: { userId: { in: userIds } } }) : 0;
  const rechargeCodes = rechargeCodeFilters.length
    ? await prisma.rechargeCode.count({ where: { OR: rechargeCodeFilters } })
    : 0;
  const walletTransactions = walletTransactionFilters.length
    ? await prisma.walletTransaction.count({ where: { OR: walletTransactionFilters } })
    : 0;
  const adminAuditLogs = adminAuditFilters.length
    ? await prisma.adminAuditLog.count({ where: { OR: adminAuditFilters } })
    : 0;
  const securityAuditLogs = securityAuditFilters.length
    ? await prisma.securityAuditLog.count({ where: { OR: securityAuditFilters } })
    : 0;

  return {
    users: base.users,
    wallets,
    sessions,
    rechargeCodes,
    walletTransactions,
    adminAuditLogs,
    securityAuditLogs
  };
}

async function cleanup(adminUserId: string | '', ordinaryUserId: string = '') {
  const userIds: string[] = [];
  if (adminUserId) {
    userIds.push(adminUserId);
  }
  if (ordinaryUserId) {
    userIds.push(ordinaryUserId);
  }
  const uniqueUserIds = Array.from(new Set(userIds));

  if (!uniqueUserIds.length && !knownCodeIds.length) {
    return;
  }

  const codeLookupFilters: Prisma.RechargeCodeWhereInput[] = [];
  if (knownCodeIds.length > 0) {
    codeLookupFilters.push({ id: { in: knownCodeIds } });
  }
  if (uniqueUserIds.length > 0) {
    codeLookupFilters.push({ createdByAdminId: { in: uniqueUserIds } }, { usedByUserId: { in: uniqueUserIds } });
  }
  const relatedCodeIds = codeLookupFilters.length
    ? (
        await prisma.rechargeCode.findMany({
          where: { OR: codeLookupFilters },
          select: { id: true }
        })
      ).map((entry) => entry.id)
    : [];

  if (uniqueUserIds.length || knownCodeIds.length) {
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [{ adminUserId: { in: uniqueUserIds } }, { targetId: { in: knownCodeIds } }]
      }
    });
    await prisma.securityAuditLog.deleteMany({
      where: {
        OR: [{ actorUserId: { in: uniqueUserIds } }, { targetId: { in: knownCodeIds } }]
      }
    });
  }

  if (relatedCodeIds.length) {
    await prisma.walletTransaction.deleteMany({
      where: {
        OR: [{ userId: { in: uniqueUserIds } }, { rechargeCodeId: { in: relatedCodeIds } }]
      }
    });
    await prisma.rechargeCode.deleteMany({
      where: { id: { in: relatedCodeIds } }
    });
  }

  if (uniqueUserIds.length) {
    await prisma.session.deleteMany({
      where: { userId: { in: uniqueUserIds } }
    });
    await prisma.wallet.deleteMany({
      where: { userId: { in: uniqueUserIds } }
    });
    await prisma.user.deleteMany({
      where: { id: { in: uniqueUserIds } }
    });
  }
}

function assertResidualZero(result: ResidualCounts | null) {
  if (!result) {
    return;
  }

  assert(result.users === 0, `residual users should be 0, got ${result.users}`);
  assert(result.wallets === 0, `residual wallets should be 0, got ${result.wallets}`);
  assert(result.sessions === 0, `residual sessions should be 0, got ${result.sessions}`);
  assert(result.rechargeCodes === 0, `residual recharge codes should be 0, got ${result.rechargeCodes}`);
  assert(result.walletTransactions === 0, `residual walletTransactions should be 0, got ${result.walletTransactions}`);
  assert(result.adminAuditLogs === 0, `residual adminAuditLogs should be 0, got ${result.adminAuditLogs}`);
  assert(result.securityAuditLogs === 0, `residual securityAuditLogs should be 0, got ${result.securityAuditLogs}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void main();
