import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomBytes } from 'node:crypto';
import {
  PrismaClient,
  RechargeCodeStatus,
  UserRole,
  WalletTransactionType
} from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  cookie?: string;
};

type CreateCodesResponse = {
  items: Array<{
    id: string;
    code: string;
    amountCents: number;
    status: string;
  }>;
};

type ListCodesResponse = {
  items: Array<Record<string, unknown> & { id: string; status: string }>;
};

type RedeemResponse = {
  recharge: { id: string; amountCents: number };
  wallet: { balanceCents: number };
  transaction: { id: string; amountCents: number; balanceAfterCents: number };
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const AMOUNT_CENTS = 1234;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T10 recharge QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const usernamePrefix = `qa_t10_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];
const knownCodeIds: string[] = [];

async function main() {
  const adminUsername = `${usernamePrefix}_admin`;
  const userUsername = `${usernamePrefix}_user`;

  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const adminCookie = await register(adminUsername);
    const userCookie = await register(userUsername);

    const admin = await prisma.user.update({
      where: { username: adminUsername },
      data: { role: UserRole.ADMIN }
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { username: userUsername } });

    const blocked = await post('/admin/recharge-codes', { amountCents: AMOUNT_CENTS, count: 1 }, userCookie);
    assert(blocked.status === 403, `non-admin create should be 403, got ${blocked.status}`);
    checks.push('admin_guard_blocks_user');

    const created = await post<CreateCodesResponse>(
      '/admin/recharge-codes',
      { amountCents: AMOUNT_CENTS, count: 5 },
      adminCookie
    );
    assert(created.status >= 200 && created.status < 300, `admin create failed with ${created.status}`);
    assert(created.json.items.length === 5, `expected 5 recharge codes, got ${created.json.items.length}`);
    created.json.items.forEach((item) => knownCodeIds.push(item.id));
    checks.push('admin_generates_codes_once');

    const dbCodes = await prisma.rechargeCode.findMany({
      where: { id: { in: knownCodeIds } },
      orderBy: { createdAt: 'asc' }
    });
    assert(dbCodes.length === 5, `expected 5 DB recharge codes, got ${dbCodes.length}`);
    for (const item of created.json.items) {
      const dbCode = dbCodes.find((entry) => entry.id === item.id);
      assert(dbCode, `missing DB recharge code ${item.id}`);
      assert(dbCode!.codeHash === hashRechargeCode(item.code), `stored hash mismatch for ${item.id}`);
      assert(dbCode!.codeHash !== item.code, `plain code stored as hash for ${item.id}`);
    }
    checks.push('database_stores_hash_not_plain_code');

    const auditLogs = await prisma.adminAuditLog.findMany({
      where: { targetId: { in: knownCodeIds } }
    });
    const auditPayload = JSON.stringify(auditLogs);
    for (const item of created.json.items) {
      assert(!auditPayload.includes(item.code), `audit log leaked plain recharge code ${item.id}`);
      assert(!auditPayload.includes(hashRechargeCode(item.code)), `audit log leaked recharge hash ${item.id}`);
    }
    checks.push('audit_logs_hide_plain_code_and_hash');

    const adminList = await get<ListCodesResponse>('/admin/recharge-codes', adminCookie);
    assert(adminList.status === 200, `admin list failed with ${adminList.status}`);
    for (const item of adminList.json.items.filter((entry) => knownCodeIds.includes(entry.id))) {
      assert(!Object.prototype.hasOwnProperty.call(item, 'code'), `admin list leaked plain code for ${item.id}`);
      assert(!Object.prototype.hasOwnProperty.call(item, 'codeHash'), `admin list leaked code hash for ${item.id}`);
    }
    checks.push('admin_list_hides_plain_code');

    const firstCode = created.json.items[0]!;
    const redeem = await post<RedeemResponse>('/recharge/redeem', { code: firstCode.code }, userCookie);
    assert(redeem.status >= 200 && redeem.status < 300, `redeem failed with ${redeem.status}`);
    assert(redeem.json.wallet.balanceCents === AMOUNT_CENTS, 'wallet balance did not increase after redeem');

    const rechargeTransaction = await prisma.walletTransaction.findFirstOrThrow({
      where: {
        userId: user.id,
        rechargeCodeId: firstCode.id,
        type: WalletTransactionType.RECHARGE
      }
    });
    assert(rechargeTransaction.amountCents === AMOUNT_CENTS, 'recharge transaction amount mismatch');
    assert(rechargeTransaction.idempotencyKey === `recharge:${firstCode.id}`, 'recharge idempotency key mismatch');
    checks.push('user_redeems_code_wallet_and_ledger');

    const duplicate = await post('/recharge/redeem', { code: firstCode.code }, userCookie);
    assert(duplicate.status === 409, `duplicate redeem should be 409, got ${duplicate.status}`);
    await assertWalletBalance(user.id, AMOUNT_CENTS, 'duplicate redeem changed balance');
    checks.push('duplicate_redeem_no_balance_change');

    const disableUsed = await post(`/admin/recharge-codes/${firstCode.id}/disable`, {}, adminCookie);
    assert(disableUsed.status === 409, `disable used code should be 409, got ${disableUsed.status}`);
    checks.push('disable_used_code_returns_business_conflict');

    const disabledCode = created.json.items[1]!;
    const disableUnused = await post(`/admin/recharge-codes/${disabledCode.id}/disable`, {}, adminCookie);
    assert(disableUnused.status >= 200 && disableUnused.status < 300, `disable unused failed with ${disableUnused.status}`);
    const redeemDisabled = await post('/recharge/redeem', { code: disabledCode.code }, userCookie);
    assert(redeemDisabled.status === 400, `redeem disabled should be 400, got ${redeemDisabled.status}`);
    await assertWalletBalance(user.id, AMOUNT_CENTS, 'disabled code changed balance');
    checks.push('disabled_code_no_balance_change');

    const invalid = await post('/recharge/redeem', { code: 'RC-00000000000000000000000000000000' }, userCookie);
    assert(invalid.status === 400, `invalid code should be 400, got ${invalid.status}`);
    await assertWalletBalance(user.id, AMOUNT_CENTS, 'invalid code changed balance');
    checks.push('invalid_code_no_balance_change');

    const concurrentRedeemCode = created.json.items[2]!;
    const concurrentRedeemResults = await Promise.all([
      post('/recharge/redeem', { code: concurrentRedeemCode.code }, userCookie),
      post('/recharge/redeem', { code: concurrentRedeemCode.code }, userCookie)
    ]);
    const redeemSuccesses = concurrentRedeemResults.filter((entry) => entry.status >= 200 && entry.status < 300);
    const redeemConflicts = concurrentRedeemResults.filter((entry) => entry.status === 409);
    assert(redeemSuccesses.length === 1, `expected one concurrent redeem success, got ${redeemSuccesses.length}`);
    assert(redeemConflicts.length === 1, `expected one concurrent redeem conflict, got ${redeemConflicts.length}`);
    await assertWalletBalance(user.id, AMOUNT_CENTS * 2, 'concurrent redeem changed balance incorrectly');
    checks.push('concurrent_same_code_single_success');

    const raceCode = created.json.items[3]!;
    const disableRaceResults = await Promise.all([
      post(`/admin/recharge-codes/${raceCode.id}/disable`, {}, adminCookie),
      post('/recharge/redeem', { code: raceCode.code }, userCookie)
    ]);
    assert(
      disableRaceResults.every((entry) => entry.status < 500),
      `concurrent disable/redeem returned server error: ${disableRaceResults.map((entry) => entry.status).join(',')}`
    );
    const raceState = await prisma.rechargeCode.findUniqueOrThrow({ where: { id: raceCode.id } });
    assert(
      [RechargeCodeStatus.DISABLED, RechargeCodeStatus.USED].includes(raceState.status),
      `unexpected race code status ${raceState.status}`
    );
    checks.push('concurrent_disable_or_redeem_no_server_error');

    const records = await get<{ items: Array<{ rechargeCodeId: string | null; amountCents: number }> }>(
      '/recharge/records',
      userCookie
    );
    assert(records.status === 200, `records failed with ${records.status}`);
    assert(
      records.json.items.every((entry) => entry.rechargeCodeId && entry.amountCents > 0),
      'recharge records include non-real recharge transaction'
    );
    checks.push('user_recharge_records_are_real_recharge_transactions');

    residualBeforeCleanup = await countResidual(usernamePrefix);

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          codeCount: knownCodeIds.length,
          residualBeforeCleanup
        },
        null,
        2
      )
    );
  } finally {
    await cleanup(usernamePrefix);
    const residualAfterCleanup = await countResidual(usernamePrefix);
    console.log(JSON.stringify({ cleanup: true, suffix, residualAfterCleanup }, null, 2));
    await prisma.$disconnect();
  }
}

async function register(username: string) {
  const result = await post<{ user: { id: string } }>('/auth/register', { username, password });
  assert(result.status >= 200 && result.status < 300, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return a session cookie`);
  return result.cookie!;
}

async function get<T>(path: string, cookie?: string) {
  return request<T>('GET', path, undefined, cookie);
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string) {
  return request<T>('POST', path, body, cookie);
}

async function request<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return {
    status: response.status,
    json,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function assertWalletBalance(userId: string, expectedBalanceCents: number, message: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  assert(wallet.balanceCents === expectedBalanceCents, `${message}: expected ${expectedBalanceCents}, got ${wallet.balanceCents}`);
}

async function countResidual(prefix: string) {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  return {
    users: users.length,
    sessions: await prisma.session.count({ where: { userId: { in: userIds } } }),
    recharge_codes: await prisma.rechargeCode.count({
      where: {
        OR: [
          { id: { in: knownCodeIds } },
          { createdByAdminId: { in: userIds } },
          { usedByUserId: { in: userIds } }
        ]
      }
    }),
    wallet_transactions: await prisma.walletTransaction.count({
      where: {
        OR: [
          { userId: { in: userIds } },
          { rechargeCodeId: { in: knownCodeIds } }
        ]
      }
    }),
    admin_audit_logs: await prisma.adminAuditLog.count({
      where: {
        OR: [
          { adminUserId: { in: userIds } },
          { targetId: { in: knownCodeIds } }
        ]
      }
    })
  };
}

async function cleanup(prefix: string) {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { adminUserId: { in: userIds } },
        { targetId: { in: knownCodeIds } }
      ]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { rechargeCodeId: { in: knownCodeIds } }
      ]
    }
  });
  await prisma.rechargeCode.deleteMany({
    where: {
      OR: [
        { id: { in: knownCodeIds } },
        { createdByAdminId: { in: userIds } },
        { usedByUserId: { in: userIds } }
      ]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function hashRechargeCode(code: string) {
  return createHash('sha256').update(`recharge-code:${code}`).digest('hex');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
