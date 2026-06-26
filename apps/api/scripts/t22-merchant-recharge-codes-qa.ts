import { PrismaPg } from '@prisma/adapter-pg';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma, PrismaClient, RechargeCodeKind, RechargeCodeStatus, UserRole, UserStatus } from '../src/generated/prisma/client';

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
    kind: string;
    amountCents: number;
    amountBaseTokens: number;
    faceValueCnyCents: number;
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
    status: string;
  }>;
};

type AdminListResponse = {
  items: Array<
    Record<string, unknown> & {
      id: string;
      kind: string;
      status: string;
      amountCents: number;
      amountBaseTokens: number;
      faceValueCnyCents: number;
      quotaHours: number | null;
      quotaPeriodDays: number | null;
      tokenQuota: number | null;
    }
  >;
};

type RedeemResponse = {
  recharge: {
    id: string;
    kind: string;
    amountCents: number;
    amountBaseTokens: number;
    faceValueCnyCents: number;
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
    entitlement: {
      id: string;
      quotaHours: number;
      quotaPeriodDays: number;
      tokenQuota: number;
      usedTokenQuota: number;
      startsAt: string;
      expiresAt: string;
      status: string;
    } | null;
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
  vibeCodingEntitlements: number;
  walletTransactions: number;
  adminAuditLogs: number;
  securityAuditLogs: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;
const FACE_VALUE_CNY_CENTS = 100;
const EXPECTED_BASE_TOKENS = 1_000_000;
const CODE_COUNT = 2;
const VIBE_QUOTA_HOURS = 5;
const VIBE_QUOTA_PERIOD_DAYS = 7;
const VIBE_TOKEN_QUOTA = 50_000;

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
      assert(item.kind === 'balance', `created balance code kind mismatch for ${item.id}`);
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
      assert(dbCode.kind === RechargeCodeKind.BALANCE, `DB kind mismatch for balance code ${item.id}`);
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
      assert(listed.kind === 'balance', `admin list kind mismatch for balance code ${id}`);
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

    const vibeCreated = await post<CreateResponse>(
      '/admin/recharge-codes',
      {
        codeKind: 'vibe_coding',
        count: 1,
        quotaHours: VIBE_QUOTA_HOURS,
        quotaPeriodDays: VIBE_QUOTA_PERIOD_DAYS,
        tokenQuota: VIBE_TOKEN_QUOTA
      },
      merchantCookie
    );
    assert(vibeCreated.status === 200 || vibeCreated.status === 201, `admin create vibe coding code failed with ${vibeCreated.status}`);
    assert(vibeCreated.json.items.length === 1, `expected 1 vibe coding recharge item, got ${vibeCreated.json.items.length}`);
    const vibeCode = vibeCreated.json.items[0];
    assert(typeof vibeCode.code === 'string' && vibeCode.code.length > 0, `vibe code ${vibeCode.id} is missing plain code`);
    assert(vibeCreated.text.includes(vibeCode.code), `vibe create response missing plaintext code ${vibeCode.code}`);
    assert(vibeCode.kind === 'vibe_coding', `vibe code response kind mismatch for ${vibeCode.id}`);
    assert(vibeCode.amountCents === 0, `vibe code should not credit wallet balance for ${vibeCode.id}`);
    assert(vibeCode.amountBaseTokens === 0, `vibe code should not expose base token credit for ${vibeCode.id}`);
    assert(vibeCode.quotaHours === VIBE_QUOTA_HOURS, `vibe code quotaHours mismatch for ${vibeCode.id}`);
    assert(vibeCode.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS, `vibe code quotaPeriodDays mismatch for ${vibeCode.id}`);
    assert(vibeCode.tokenQuota === VIBE_TOKEN_QUOTA, `vibe code tokenQuota mismatch for ${vibeCode.id}`);
    knownCodeIds.push(vibeCode.id);
    knownPlainCodes.push(vibeCode.code);

    const vibeDbCode = await prisma.rechargeCode.findUniqueOrThrow({ where: { id: vibeCode.id } });
    assert(vibeDbCode.kind === RechargeCodeKind.VIBE_CODING, `DB kind mismatch for vibe code ${vibeCode.id}`);
    assert(vibeDbCode.amountCents === 0, `DB amount should be zero for vibe code ${vibeCode.id}`);
    assert(vibeDbCode.quotaHours === VIBE_QUOTA_HOURS, `DB quotaHours mismatch for vibe code ${vibeCode.id}`);
    assert(vibeDbCode.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS, `DB quotaPeriodDays mismatch for vibe code ${vibeCode.id}`);
    assert(vibeDbCode.tokenQuota === VIBE_TOKEN_QUOTA, `DB tokenQuota mismatch for vibe code ${vibeCode.id}`);

    const adminListAfterVibe = await get<AdminListResponse>('/admin/recharge-codes', merchantCookie);
    assert(adminListAfterVibe.status === 200, `admin list after vibe code failed with ${adminListAfterVibe.status}`);
    const listedVibe = adminListAfterVibe.json.items.find((entry) => entry.id === vibeCode.id);
    assert(!!listedVibe, `admin list should include vibe code ${vibeCode.id}`);
    assert(listedVibe.kind === 'vibe_coding', `admin list kind mismatch for vibe code ${vibeCode.id}`);
    assert(listedVibe.quotaHours === VIBE_QUOTA_HOURS, `admin list quotaHours mismatch for vibe code ${vibeCode.id}`);
    assert(listedVibe.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS, `admin list quotaPeriodDays mismatch for vibe code ${vibeCode.id}`);
    assert(listedVibe.tokenQuota === VIBE_TOKEN_QUOTA, `admin list tokenQuota mismatch for vibe code ${vibeCode.id}`);
    assert(!adminListAfterVibe.text.includes(vibeCode.code), `admin list leaked vibe plaintext code ${vibeCode.code}`);
    checks.push('admin_can_create_and_archive_vibecoding_package_codes');

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
    assert(redeem.json.recharge.kind === 'balance', 'redeem balance kind mismatch');
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

    const beforeVibeRedeemWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: seeded.userIds.user } });
    const vibeRedeem = await post<RedeemResponse>('/recharge/redeem', { code: vibeCode.code }, userCookie);
    assert(vibeRedeem.status === 200 || vibeRedeem.status === 201, `vibe redeem should be successful, got ${vibeRedeem.status}`);
    assert(vibeRedeem.json.recharge.id === vibeCode.id, 'vibe redeem response should reference redeemed code id');
    assert(vibeRedeem.json.recharge.kind === 'vibe_coding', 'vibe redeem kind mismatch');
    assert(vibeRedeem.json.recharge.amountCents === 0, 'vibe redeem should expose zero wallet credit');
    assert(vibeRedeem.json.recharge.quotaHours === VIBE_QUOTA_HOURS, 'vibe redeem quotaHours mismatch');
    assert(vibeRedeem.json.recharge.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS, 'vibe redeem quotaPeriodDays mismatch');
    assert(vibeRedeem.json.recharge.tokenQuota === VIBE_TOKEN_QUOTA, 'vibe redeem tokenQuota mismatch');
    assert(vibeRedeem.json.recharge.entitlement !== null, 'vibe redeem should create a user entitlement');
    assert(vibeRedeem.json.recharge.entitlement?.quotaHours === VIBE_QUOTA_HOURS, 'vibe entitlement quotaHours mismatch');
    assert(vibeRedeem.json.recharge.entitlement?.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS, 'vibe entitlement quotaPeriodDays mismatch');
    assert(vibeRedeem.json.recharge.entitlement?.tokenQuota === VIBE_TOKEN_QUOTA, 'vibe entitlement tokenQuota mismatch');
    assert(vibeRedeem.json.recharge.entitlement?.usedTokenQuota === 0, 'new vibe entitlement should start with zero usedTokenQuota');
    assert(vibeRedeem.json.recharge.entitlement?.status === 'active', 'new vibe entitlement should be active');
    assert(vibeRedeem.json.wallet.balanceCents === beforeVibeRedeemWallet.balanceCents, 'vibe redeem must not increase wallet balance');
    const afterVibeRedeemWallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: seeded.userIds.user } });
    assert(afterVibeRedeemWallet.balanceCents === beforeVibeRedeemWallet.balanceCents, 'DB wallet balance must remain unchanged after vibe redeem');
    const vibeRedeemedCode = await prisma.rechargeCode.findUniqueOrThrow({ where: { id: vibeCode.id } });
    assert(vibeRedeemedCode.status === RechargeCodeStatus.USED, 'vibe code should be marked used');
    assert(vibeRedeemedCode.usedByUserId === seeded.userIds.user, 'vibe code should record usedByUserId');
    const dbEntitlement = await prisma.vibeCodingEntitlement.findUniqueOrThrow({
      where: { sourceRechargeCodeId: vibeCode.id }
    });
    assert(dbEntitlement.userId === seeded.userIds.user, 'vibe entitlement should belong to the redeeming user');
    assert(dbEntitlement.quotaHours === VIBE_QUOTA_HOURS, 'DB vibe entitlement quotaHours mismatch');
    assert(dbEntitlement.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS, 'DB vibe entitlement quotaPeriodDays mismatch');
    assert(dbEntitlement.tokenQuota === VIBE_TOKEN_QUOTA, 'DB vibe entitlement tokenQuota mismatch');
    assert(dbEntitlement.usedTokenQuota === 0, 'DB vibe entitlement should start with zero usedTokenQuota');
    assert(dbEntitlement.expiresAt.getTime() > dbEntitlement.startsAt.getTime(), 'DB vibe entitlement should have an expiry after start');
    const vibeTransaction = await prisma.walletTransaction.findUniqueOrThrow({ where: { rechargeCodeId: vibeCode.id } });
    assert(vibeTransaction.amountCents === 0, 'vibe redemption transaction should be zero amount');
    assert(vibeTransaction.balanceAfterCents === beforeVibeRedeemWallet.balanceCents, 'vibe redemption balanceAfter should not change');
    checks.push('ordinary_user_redeems_vibecoding_code_without_wallet_credit');
    checks.push('ordinary_user_redeems_vibecoding_code_into_entitlement_ledger');

    const records = await get<{
      items: Array<{
        rechargeCodeId: string | null;
        rechargeCodeKind: string | null;
        amountCents: number;
        amountBaseTokens: number;
        faceValueCnyCents: number | null;
        quotaHours: number | null;
        quotaPeriodDays: number | null;
        tokenQuota: number | null;
        vibeCodingEntitlement?: {
          id: string;
          quotaHours: number;
          quotaPeriodDays: number;
          tokenQuota: number;
          usedTokenQuota: number;
          status: string;
        } | null;
        status: string;
      }>;
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
          entry.rechargeCodeKind === 'balance' &&
          entry.amountBaseTokens === EXPECTED_BASE_TOKENS &&
          entry.faceValueCnyCents === FACE_VALUE_CNY_CENTS
      ),
      'recharge records should expose base token amount and RMB face value'
    );
    assert(
      records.json.items.some(
        (entry) =>
          entry.rechargeCodeId === vibeCode.id &&
          entry.rechargeCodeKind === 'vibe_coding' &&
          entry.amountBaseTokens === 0 &&
          entry.quotaHours === VIBE_QUOTA_HOURS &&
          entry.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS &&
          entry.tokenQuota === VIBE_TOKEN_QUOTA &&
          entry.vibeCodingEntitlement?.quotaHours === VIBE_QUOTA_HOURS &&
          entry.vibeCodingEntitlement?.quotaPeriodDays === VIBE_QUOTA_PERIOD_DAYS &&
          entry.vibeCodingEntitlement?.tokenQuota === VIBE_TOKEN_QUOTA &&
          entry.vibeCodingEntitlement?.status === 'active'
      ),
      'recharge records should expose vibecoding package quota and entitlement fields'
    );

    for (const plainCode of knownPlainCodes) {
      assert(!adminListAfterVibe.text.includes(plainCode), 'admin list still should not expose plaintext code after operations');
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
  const markers = ['merchant-shell-page', '充值码管理', '生成充值码', '充值码状态', '兑换码类型', 'VibeCoding 套餐码'];
  const found = markers.filter((marker) => text.includes(marker)).length;
  assert(found >= 5, `merchant recharge-code page missing expected markers, found ${found}`);
  assert(text.includes('data-qa="merchant-recharge-code-form"'), 'merchant recharge-code page missing create form QA marker');
  assert(text.includes('data-qa="merchant-recharge-kind"'), 'merchant recharge-code page missing code kind QA marker');
  assert(text.includes('data-qa="merchant-recharge-submit"'), 'merchant recharge-code page missing submit QA marker');
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
    vibeCodingEntitlements: 0,
    walletTransactions: 0,
    adminAuditLogs: 0,
    securityAuditLogs: 0
  };

  if (userIds.length === 0 && knownCodeIds.length === 0) {
    return base;
  }

  const rechargeCodeFilters: Prisma.RechargeCodeWhereInput[] = [];
  const entitlementFilters: Prisma.VibeCodingEntitlementWhereInput[] = [];
  const walletTransactionFilters: Prisma.WalletTransactionWhereInput[] = [];
  const adminAuditFilters: Prisma.AdminAuditLogWhereInput[] = [];
  const securityAuditFilters: Prisma.SecurityAuditLogWhereInput[] = [];

  if (userIds.length > 0) {
    rechargeCodeFilters.push({ createdByAdminId: { in: userIds } }, { usedByUserId: { in: userIds } });
    entitlementFilters.push({ userId: { in: userIds } });
    walletTransactionFilters.push({ userId: { in: userIds } });
    adminAuditFilters.push({ adminUserId: { in: userIds } });
    securityAuditFilters.push({ actorUserId: { in: userIds } }, { targetId: { in: userIds } });
  }

  if (knownCodeIds.length > 0) {
    rechargeCodeFilters.push({ id: { in: knownCodeIds } });
    entitlementFilters.push({ sourceRechargeCodeId: { in: knownCodeIds } });
    walletTransactionFilters.push({ rechargeCodeId: { in: knownCodeIds } });
    adminAuditFilters.push({ targetId: { in: knownCodeIds } });
    securityAuditFilters.push({ targetId: { in: knownCodeIds } });
  }

  const wallets = userIds.length ? await prisma.wallet.count({ where: { userId: { in: userIds } } }) : 0;
  const sessions = userIds.length ? await prisma.session.count({ where: { userId: { in: userIds } } }) : 0;
  const rechargeCodes = rechargeCodeFilters.length
    ? await prisma.rechargeCode.count({ where: { OR: rechargeCodeFilters } })
    : 0;
  const vibeCodingEntitlements = entitlementFilters.length
    ? await prisma.vibeCodingEntitlement.count({ where: { OR: entitlementFilters } })
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
    vibeCodingEntitlements,
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

  if (uniqueUserIds.length || relatedCodeIds.length) {
    await prisma.vibeCodingEntitlement.deleteMany({
      where: {
        OR: [
          ...(uniqueUserIds.length ? [{ userId: { in: uniqueUserIds } }] : []),
          ...(relatedCodeIds.length ? [{ sourceRechargeCodeId: { in: relatedCodeIds } }] : [])
        ]
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
  assert(result.vibeCodingEntitlements === 0, `residual vibeCodingEntitlements should be 0, got ${result.vibeCodingEntitlements}`);
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
