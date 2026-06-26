import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import { ApiTokenStatus, PrismaClient, UsageEventStatus, UserRole, UpstreamProviderStatus } from '../src/generated/prisma/client';

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

type ProductResponse = {
  id: string;
  title: string;
  platform: string;
  planName: string;
  durationDays: number | null;
  priceCnyCents: number;
  description: string;
  purchaseNote: string | null;
  deliveryNote: string | null;
  productKind?: string | null;
  quotaHours?: number | null;
  quotaPeriodDays?: number | null;
  tokenQuota?: number | null;
  tokenQuotaCents?: number | null;
  sortOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ProductListResponse = {
  items: ProductResponse[];
};

type OrderResponse = {
  id: string;
  productId: string;
  status: string;
};

type CreateOrderResponse = {
  order: OrderResponse;
};

type DashboardSummaryResponse = {
  topUsers: Array<{
    id: string;
    username: string;
    usage?: {
      totalTokens?: number;
    };
  }>;
};

type UsageLeaderboardItem = {
  rank?: number;
  userId?: string | null;
  username?: string;
  totalTokens?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  requestCount?: unknown;
};

type UsageLeaderboardResponse = {
  items?: UsageLeaderboardItem[];
};

type RecoveryRequestResponse = {
  ok?: boolean;
  channel?: string;
  providerConfigured?: boolean;
  message?: string;
  debugCode?: string;
};

type PasswordResetResponse = {
  ok?: boolean;
  message?: string;
};

type ErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
  message?: string;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run T30 vibecoding QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const prefix = `qa_t30_${suffix}`;
const password = `qa-password-${suffix}`;
const resetPassword = `qa-password-reset-${suffix}`;
const scriptStartedAt = new Date();
const adminUsername = `${prefix}_admin`;
const userAUsername = `${prefix}_user_a`;
const userBUsername = `${prefix}_user_b`;
const phoneUsername = `${prefix}_user_phone`;
const checks: string[] = [];
const todos: string[] = [];
const authAttemptActions = [
  'phone_login_attempted',
  'password_recovery_requested',
  'password_reset_by_phone_attempted'
];
const expectedVibePackage = {
  quotaHours: 5,
  quotaPeriodDays: 7
};
const signedInt32Max = 2_147_483_647;
const oversizedTokenQuota = signedInt32Max + 1;

const productSeed = {
  title: `${prefix}_vibe_plan`,
  platform: 'vibe-coding',
  planName: 'Vibe Time',
  durationDays: 30,
  priceCnyCents: 999,
  description: 'QA vibration coding quota plan',
  purchaseNote: 'qa purchase note',
  deliveryNote: 'qa delivery note',
  productKind: 'vibe_coding',
  tokenQuota: 50000,
  sortOrder: 100,
  status: 'active'
};

const dailyProductSeed = {
  ...productSeed,
  title: `${prefix}_vibe_daily_plan`,
  planName: 'Vibe Daily',
  durationDays: 1,
  priceCnyCents: 199,
  quotaHours: 5,
  quotaPeriodDays: 1,
  tokenQuota: 25000,
  sortOrder: 101
};

const usageSeed = {
  userA: 2_000_000_000,
  userB: 1_900_000_000,
  model: `${prefix}_model`
};
const phoneLoginQaIp = '203.0.113.30';
const recoveryFlowIp = '203.0.113.31';
const recoveryLoginCheckIp = '203.0.113.32';

async function main() {
  let adminId: string | null = null;
  let providerId: string | null = null;
  let tokenAId: string | null = null;
  let tokenBId: string | null = null;
  let productId: string | null = null;
  let dailyProductId: string | null = null;

  try {
    const adminSession = await register(adminUsername);
    const userASession = await register(userAUsername);
    const userBSession = await register(userBUsername);
    const phoneNumber = `+86139${Date.now().toString().slice(-8)}`;
    const phoneSession = await register(phoneUsername, phoneNumber);

    adminId = adminSession.userId;
    await prisma.user.update({ where: { id: adminId }, data: { role: UserRole.ADMIN } });

    const userA = await getUserByUsername(userAUsername);
    const userB = await getUserByUsername(userBUsername);

    checks.push('setup_created_admin_and_user_accounts');
    const phoneUser = await prisma.user.findUnique({
      where: { id: phoneSession.userId },
      select: { phoneNumber: true, phoneVerifiedAt: true }
    });
    assert(phoneUser?.phoneNumber === phoneNumber, 'registered user should persist phoneNumber');
    assert(phoneUser.phoneVerifiedAt === null, 'phoneVerifiedAt should stay null until SMS verification is connected');
    checks.push('phone_number_is_login_identifier_not_verified_without_sms');

    await verifyDuplicatePhoneRegistration(phoneNumber);
    await verifyUsernameLoginStillWorks(userAUsername);

    const createProduct = await post<ProductResponse>('/admin/ai-recharge/products', productSeed, adminSession.cookie);
    assert(
      createProduct.status === 200 || createProduct.status === 201,
      `admin create vibecoding product route must exist and persist package fields, got ${createProduct.status}`
    );
    productId = createProduct.json.id;
    checks.push('admin_can_create_product_endpoint');

    const createHasFields = expectProductVibecodingResponse('admin create', createProduct.json, {
      ...expectedVibePackage,
      tokenQuota: productSeed.tokenQuota
    });
    assert(createHasFields, `admin create response must expose vibecoding fields for ${createProduct.json.id}`);

    const dbCreate = await prisma.aiRechargeProduct.findUnique({
      where: { id: createProduct.json.id },
      select: {
        productKind: true,
        quotaHours: true,
        quotaPeriodDays: true,
        tokenQuota: true
      }
    });
    expectProductVibecodingDb('admin create', createProduct.json.id, dbCreate, {
      quotaHours: expectedVibePackage.quotaHours,
      quotaPeriodDays: expectedVibePackage.quotaPeriodDays,
      tokenQuota: productSeed.tokenQuota
    });

    const updatePayload = {
      ...productSeed,
      title: `${prefix}_vibe_plan_updated`,
      quotaHours: 10,
      tokenQuota: 90000,
      planName: 'Vibe Time (updated)'
    };

    const updateProduct = await post<ProductResponse>(
      `/admin/ai-recharge/products/${encodeURIComponent(createProduct.json.id)}/update`,
      updatePayload,
      adminSession.cookie
    );
    assert(
      updateProduct.status === 200 || updateProduct.status === 201,
      `admin update vibecoding product route must exist and preserve package fields, got ${updateProduct.status}`
    );
    checks.push('admin_can_update_product_endpoint');

    const updateHasFields = expectProductVibecodingResponse('admin update', updateProduct.json, {
      quotaHours: updatePayload.quotaHours,
      quotaPeriodDays: expectedVibePackage.quotaPeriodDays,
      tokenQuota: updatePayload.tokenQuota
    });
    assert(updateHasFields, `admin update response must expose vibecoding fields for ${updateProduct.json.id}`);

    const dbUpdate = await prisma.aiRechargeProduct.findUnique({
      where: { id: createProduct.json.id },
      select: {
        productKind: true,
        quotaHours: true,
        quotaPeriodDays: true,
        tokenQuota: true
      }
    });
    expectProductVibecodingDb('admin update', createProduct.json.id, dbUpdate, {
      quotaHours: 10,
      quotaPeriodDays: expectedVibePackage.quotaPeriodDays,
      tokenQuota: updatePayload.tokenQuota
    });
    assert(
      updateProduct.json.tokenQuota === dbUpdate?.tokenQuota,
      `admin update tokenQuota mismatch between API response and DB for ${createProduct.json.id}`
    );

    const oversizedUpdate = await post<ProductResponse>(
      `/admin/ai-recharge/products/${encodeURIComponent(createProduct.json.id)}/update`,
      {
        ...updatePayload,
        tokenQuota: oversizedTokenQuota
      },
      adminSession.cookie
    );
    assert(
      oversizedUpdate.status === 400,
      `admin update should reject tokenQuota above signed int range (${signedInt32Max}), got ${oversizedUpdate.status}`
    );
    checks.push('admin_update_rejects_oversized_tokenQuota');

    const createDailyProduct = await post<ProductResponse>('/admin/ai-recharge/products', dailyProductSeed, adminSession.cookie);
    assert(
      createDailyProduct.status === 200 || createDailyProduct.status === 201,
      `admin create daily vibecoding product route must persist one-day package fields, got ${createDailyProduct.status}`
    );
    dailyProductId = createDailyProduct.json.id;
    checks.push('admin_can_create_daily_vibecoding_product');

    const dailyCreateHasFields = expectProductVibecodingResponse('admin create daily package', createDailyProduct.json, {
      quotaHours: dailyProductSeed.quotaHours,
      quotaPeriodDays: dailyProductSeed.quotaPeriodDays,
      tokenQuota: dailyProductSeed.tokenQuota
    });
    assert(dailyCreateHasFields, `admin create daily response must expose vibecoding fields for ${createDailyProduct.json.id}`);

    const dbDailyCreate = await prisma.aiRechargeProduct.findUnique({
      where: { id: createDailyProduct.json.id },
      select: {
        productKind: true,
        quotaHours: true,
        quotaPeriodDays: true,
        tokenQuota: true
      }
    });
    expectProductVibecodingDb('admin create daily package', createDailyProduct.json.id, dbDailyCreate, {
      quotaHours: dailyProductSeed.quotaHours,
      quotaPeriodDays: dailyProductSeed.quotaPeriodDays,
      tokenQuota: dailyProductSeed.tokenQuota
    });

    const userProductList = await get<ProductListResponse>('/ai-recharge/products', userBSession.cookie);
    assert(userProductList.status === 200, `user-visible /ai-recharge/products route must be reachable, got ${userProductList.status}`);
    const visible = userProductList.json.items.find((item) => item.id === createProduct.json.id);
    assert(Boolean(visible), 'created vibecoding product is not visible in user products list');
    if (visible) {
      const visibleHasFields = expectProductVibecodingResponse('user product list', visible);
      assert(visibleHasFields, `user products list must expose vibecoding fields for ${visible.id}`);
      checks.push('user_product_list_exposes_vibecoding_product_fields');
    }
    const visibleDaily = userProductList.json.items.find((item) => item.id === createDailyProduct.json.id);
    assert(Boolean(visibleDaily), 'created daily vibecoding product is not visible in user products list');
    if (visibleDaily) {
      const visibleDailyHasFields = expectProductVibecodingResponse('user product list daily package', visibleDaily, {
        quotaHours: dailyProductSeed.quotaHours,
        quotaPeriodDays: dailyProductSeed.quotaPeriodDays,
        tokenQuota: dailyProductSeed.tokenQuota
      });
      assert(visibleDailyHasFields, `user products list must expose daily package fields for ${visibleDaily.id}`);
      assert(visibleDaily.durationDays === 1, `user products list daily package durationDays should be 1, got ${visibleDaily.durationDays}`);
      checks.push('user_product_list_exposes_daily_vibecoding_package_fields');
    }

    const dailyOrder = await post<CreateOrderResponse>('/ai-recharge/orders', {
      productId: createDailyProduct.json.id,
      customerAccount: `${prefix}_vibe_account`,
      customerContact: `${prefix}@example.test`,
      customerNote: 'qa daily vibe package order'
    }, userBSession.cookie);
    assert(dailyOrder.status === 200 || dailyOrder.status === 201, `user should create daily vibecoding order, got ${dailyOrder.status}`);

    const fulfilledDailyOrder = await post<OrderResponse>(
      `/admin/ai-recharge/orders/${encodeURIComponent(dailyOrder.json.order.id)}/status`,
      { status: 'fulfilled', merchantNote: 'qa fulfilled daily vibe package' },
      adminSession.cookie
    );
    assert(
      fulfilledDailyOrder.status === 200 || fulfilledDailyOrder.status === 201,
      `admin should fulfill daily vibecoding order, got ${fulfilledDailyOrder.status}`
    );
    assert(fulfilledDailyOrder.json.status === 'fulfilled', `fulfilled order status mismatch: ${fulfilledDailyOrder.json.status}`);

    const orderEntitlement = await prisma.vibeCodingEntitlement.findUniqueOrThrow({
      where: { sourceAiRechargeOrderId: dailyOrder.json.order.id }
    });
    assert(orderEntitlement.userId === userB.id, 'daily order entitlement should belong to order user');
    assert(orderEntitlement.quotaHours === dailyProductSeed.quotaHours, 'daily order entitlement quotaHours mismatch');
    assert(orderEntitlement.quotaPeriodDays === dailyProductSeed.quotaPeriodDays, 'daily order entitlement quotaPeriodDays mismatch');
    assert(orderEntitlement.tokenQuota === dailyProductSeed.tokenQuota, 'daily order entitlement tokenQuota mismatch');
    assert(orderEntitlement.usedTokenQuota === 0, 'daily order entitlement should start with zero usedTokenQuota');
    assert(orderEntitlement.expiresAt.getTime() > orderEntitlement.startsAt.getTime(), 'daily order entitlement should expire after start');
    checks.push('fulfilled_daily_vibecoding_order_creates_entitlement_ledger');

    await post<OrderResponse>(
      `/admin/ai-recharge/orders/${encodeURIComponent(dailyOrder.json.order.id)}/status`,
      { status: 'fulfilled', merchantNote: 'qa fulfilled daily vibe package idempotent check' },
      adminSession.cookie
    );
    const entitlementCount = await prisma.vibeCodingEntitlement.count({
      where: { sourceAiRechargeOrderId: dailyOrder.json.order.id }
    });
    assert(entitlementCount === 1, `fulfilled daily order should create one entitlement, got ${entitlementCount}`);
    checks.push('fulfilled_daily_vibecoding_order_entitlement_is_idempotent');

    const provider = await prisma.upstreamProvider.create({
      data: {
        name: `${prefix}_leaderboard_provider`,
        baseUrl: 'http://127.0.0.1',
        encryptedApiKey: `qa-${suffix}`,
        apiKeyPreview: 'qa',
        status: UpstreamProviderStatus.ACTIVE,
        createdByAdminId: adminId
      }
    });
    providerId = provider.id;

    const tokenA = await prisma.apiToken.create({
      data: {
        userId: userA.id,
        name: `${prefix}_token_a`,
        tokenHash: `qa_token_hash_a_${suffix}`,
        keyPreview: 'qa_a',
        status: ApiTokenStatus.ACTIVE
      }
    });
    const tokenB = await prisma.apiToken.create({
      data: {
        userId: userB.id,
        name: `${prefix}_token_b`,
        tokenHash: `qa_token_hash_b_${suffix}`,
        keyPreview: 'qa_b',
        status: ApiTokenStatus.ACTIVE
      }
    });
    tokenAId = tokenA.id;
    tokenBId = tokenB.id;

    await Promise.all([
      createUsageEvent(userA.id, tokenA.id, provider.id, usageSeed.userA),
      createUsageEvent(userB.id, tokenB.id, provider.id, usageSeed.userB)
    ]);
    checks.push('seeded_leaderboard_usage_records');

    await verifyLeaderboardBehavior(userASession.cookie, userA.id);

    await verifyPasswordRecoveryFlow(phoneNumber, password, resetPassword);

    await verifyPhoneLogin(phoneUsername, phoneNumber, resetPassword);

    assert(todos.length === 0, `T30 QA has unresolved TODOs:\n${todos.join('\n')}`);
    checks.push('no_unresolved_t30_todos');

    console.log(JSON.stringify({ ok: true, suffix, checks, todos }, null, 2));
  } finally {
    await cleanup(adminId, providerId, tokenAId, tokenBId, [productId, dailyProductId], adminUsername, userAUsername, userBUsername, phoneUsername);
    await prisma.$disconnect();
  }
}

async function verifyPhoneLogin(phoneUsernameArg: string, phoneNumber: string, acceptedPassword: string) {
  const phoneLogin = await post<{ user: { id: string; username: string } }>('/auth/phone-login', {
    phoneNumber,
    password: acceptedPassword
  }, undefined, phoneLoginQaIp);
  assert(
    phoneLogin.status === 200 || phoneLogin.status === 201,
    `/auth/phone-login route must support phoneNumber + password login, got ${phoneLogin.status}`
  );
  assert(phoneLogin.json.user?.username === phoneUsernameArg, `phone login should return matched user for ${phoneNumber}`);
  assert(phoneLogin.cookie, 'phone login should issue a session cookie');
  checks.push('phone_login_supported_via_auth_phone_login');

  const wrongPassword = await post('/auth/phone-login', {
    phoneNumber,
    password: `${acceptedPassword}-wrong`
  }, undefined, phoneLoginQaIp);
  assert(wrongPassword.status === 401, `phone login should reject wrong password with 401, got ${wrongPassword.status}`);
  assert(!wrongPassword.cookie, 'wrong-password phone login must not issue a session cookie');
  checks.push('phone_login_rejects_wrong_password_without_session');

  const unknownPhone = `+86137${Date.now().toString().slice(-8)}`;
  const unknownPhoneLogin = await post('/auth/phone-login', {
    phoneNumber: unknownPhone,
    password: acceptedPassword
  }, undefined, phoneLoginQaIp);
  assert(unknownPhoneLogin.status === 401, `phone login should reject unknown phone with 401, got ${unknownPhoneLogin.status}`);
  assert(!unknownPhoneLogin.cookie, 'unknown-phone login must not issue a session cookie');
  checks.push('phone_login_rejects_unknown_phone_without_session');

  await verifyPhoneLoginRateLimit(phoneNumber, phoneLoginQaIp);
}

async function verifyDuplicatePhoneRegistration(phoneNumber: string) {
  const duplicate = await post('/auth/register', {
    username: `${prefix}_dup`,
    phoneNumber,
    password
  });
  assert(duplicate.status === 409, `duplicate phone registration should return 409, got ${duplicate.status}`);
  assert(!duplicate.cookie, 'duplicate phone registration must not issue a session cookie');
  checks.push('duplicate_phone_registration_is_rejected_without_session');
}

async function verifyUsernameLoginStillWorks(username: string) {
  const usernameLogin = await post<{ user: { username: string } }>('/auth/login', {
    username,
    password
  });
  assert(usernameLogin.status === 200 || usernameLogin.status === 201, `username login should still work, got ${usernameLogin.status}`);
  assert(usernameLogin.cookie, 'username login should issue a session cookie');
  assert(usernameLogin.json.user?.username === username, `username login returned unexpected user ${usernameLogin.json.user?.username ?? 'none'}`);
  checks.push('username_login_still_supported_alongside_phone_login');
}

async function verifyLeaderboardBehavior(
  userCookie: string,
  userAId: string
) {
  const directResponse = await get<UsageLeaderboardResponse>('/usage/token-leaderboard?period=all&limit=100', userCookie);
  assert(
    directResponse.status >= 200 && directResponse.status < 300,
    `/usage/token-leaderboard must be the user-visible leaderboard endpoint, got ${directResponse.status}`
  );

  const entries = extractLeaderboardEntries(directResponse.json);
  assert(entries.length >= 2, `/usage/token-leaderboard returned too few rows (${entries.length}); expected at least 2 seeded users`);

  const directSorted = entries.every((entry, index) => index === 0 || entry.totalTokens <= entries[index - 1].totalTokens);
  assert(directSorted, 'usage/token-leaderboard should be sorted by totalTokens descending for ranking stability');
  checks.push('usage/token-leaderboard_is_sorted_by_totalTokens_desc');

  const currentUserEntry = entries.find((entry) => entry.userId === userAId);
  assert(currentUserEntry, 'current user row is missing from /usage/token-leaderboard response');

  assert(currentUserEntry.totalTokens === usageSeed.userA, 'current user token total mismatch in /usage/token-leaderboard');
  checks.push('token-leaderboard preserves unmasked current user row for own userId');

  assert(
    entries.some((entry) => entry.totalTokens === usageSeed.userB),
    'seeded userB token total is not visible in /usage/token-leaderboard'
  );
  checks.push('token-leaderboard includes seeded userB tokens');
}

async function verifyPasswordRecoveryFlow(phoneNumber: string, oldPassword: string, newPassword: string) {
  const requestRecoveryPath = '/auth/password-recovery/request';
  const resetByPhonePath = '/auth/password-recovery/reset';
  const requestRecovery = await post<RecoveryRequestResponse | ErrorResponse>(requestRecoveryPath, {
    phoneNumber
  }, undefined, recoveryFlowIp);
  assert(
    requestRecovery.status >= 200 && requestRecovery.status < 300,
    `${requestRecoveryPath} must create a phone recovery code with a local debugCode for QA, got ${requestRecovery.status}`
  );
  const body = requestRecovery.json as RecoveryRequestResponse;
  assertRecoveryRequest(body, 'password-recovery/request');
  assert(
    typeof body.debugCode === 'string' && /^\d{6}$/.test(body.debugCode),
    'password recovery should expose a 6-digit debugCode in local/QA mode'
  );
  checks.push('password-recovery/request_creates_local_debug_code_for_existing_phone');

  const unknownRecovery = await post<RecoveryRequestResponse | ErrorResponse>(requestRecoveryPath, {
    phoneNumber: `+86136${Date.now().toString().slice(-8)}`
  }, undefined, recoveryFlowIp);
  assert(
    unknownRecovery.status >= 200 && unknownRecovery.status < 300,
    `password recovery should use a stable non-enumerating response for unknown phones, got ${unknownRecovery.status}`
  );
  const unknownBody = unknownRecovery.json as RecoveryRequestResponse;
  assertRecoveryRequest(unknownBody, 'password-recovery/request unknown phone');
  assert(
    (requestRecovery.json as RecoveryRequestResponse).message === unknownBody.message,
    'password recovery should not expose whether a phone number exists'
  );
  assert(!unknownBody.debugCode, 'unknown phone recovery must not return a debugCode');
  checks.push('password-recovery/request_does_not_enumerate_unknown_phone');

  const invalidRecovery = await post<ErrorResponse>(requestRecoveryPath, {
    phoneNumber: 'not-a-phone-number'
  }, undefined, recoveryFlowIp);
  assert(invalidRecovery.status === 400, `password recovery should reject invalid phone numbers with 400, got ${invalidRecovery.status}`);
  checks.push('password-recovery/request_rejects_invalid_phone_number');

  const wrongCodeReset = await post<ErrorResponse>(resetByPhonePath, {
    phoneNumber,
    verificationCode: '123456',
    newPassword
  }, undefined, recoveryFlowIp);
  assert(wrongCodeReset.status === 400, `password reset should reject wrong verification code with 400, got ${wrongCodeReset.status}`);
  assert(
    extractErrorMessage(wrongCodeReset.json).toLowerCase().includes('invalid'),
    'password reset wrong-code response should be a generic invalid-code message'
  );
  checks.push('password-recovery-reset_rejects_wrong_code_without_password_change');

  const oldPasswordStillWorks = await post<{ user: { id: string; username: string } }>('/auth/phone-login', {
    phoneNumber,
    password: oldPassword
  }, undefined, recoveryLoginCheckIp);
  assert(
    oldPasswordStillWorks.status === 200 || oldPasswordStillWorks.status === 201,
    `wrong-code reset should not change password, old password login got ${oldPasswordStillWorks.status}`
  );
  checks.push('wrong_recovery_code_does_not_change_password');

  const debugCode = (requestRecovery.json as RecoveryRequestResponse).debugCode!;
  const resetByPhone = await post<PasswordResetResponse | ErrorResponse>(resetByPhonePath, {
    phoneNumber,
    verificationCode: debugCode,
    newPassword
  }, undefined, recoveryFlowIp);
  assert(resetByPhone.status === 200 || resetByPhone.status === 201, `password reset with debugCode failed with ${resetByPhone.status}`);
  const resetBody = resetByPhone.json as PasswordResetResponse;
  assert(resetBody.ok === true, 'password reset success should return ok=true');
  checks.push('password-recovery-reset_accepts_valid_local_debug_code');

  const oldPasswordRejected = await post('/auth/phone-login', {
    phoneNumber,
    password: oldPassword
  }, undefined, recoveryLoginCheckIp);
  assert(oldPasswordRejected.status === 401, `old password should be rejected after reset, got ${oldPasswordRejected.status}`);
  assert(!oldPasswordRejected.cookie, 'old password login after reset must not issue a session cookie');
  checks.push('password-recovery-reset_invalidates_old_password');

  const newPasswordLogin = await post<{ user: { id: string; username: string } }>('/auth/phone-login', {
    phoneNumber,
    password: newPassword
  }, undefined, recoveryLoginCheckIp);
  assert(newPasswordLogin.status === 200 || newPasswordLogin.status === 201, `new password phone login failed with ${newPasswordLogin.status}`);
  assert(newPasswordLogin.cookie, 'new password phone login should issue a session cookie');
  checks.push('password-recovery-reset_allows_new_password_phone_login');

  const reusedCodeReset = await post<ErrorResponse>(resetByPhonePath, {
    phoneNumber,
    verificationCode: debugCode,
    newPassword: `${newPassword}-again`
  }, undefined, recoveryFlowIp);
  assert(reusedCodeReset.status === 400, `consumed recovery code should not be reusable, got ${reusedCodeReset.status}`);
  checks.push('password-recovery-reset_consumes_code_once');

  const dbUser = await prisma.user.findFirst({
    where: { phoneNumber },
    select: { id: true, phoneVerifiedAt: true }
  });
  assert(dbUser, 'successful phone reset should keep the phone user record');
  assert(dbUser.phoneVerifiedAt instanceof Date, 'successful phone reset should mark phoneVerifiedAt');
  const consumedCodes = await prisma.passwordRecoveryCode.count({
    where: {
      userId: dbUser.id,
      consumedAt: { not: null }
    }
  });
  assert(consumedCodes >= 1, 'successful phone reset should persist consumedAt on recovery code');
  checks.push('password-recovery-reset_marks_phone_verified_and_code_consumed');

  await verifyPasswordRecoveryRateLimit(phoneNumber, recoveryFlowIp);
  await verifyPasswordResetRateLimit(phoneNumber, recoveryFlowIp);
}

async function verifyPhoneLoginRateLimit(phoneNumber: string, forwardedFor: string) {
  let limited: HttpResult<unknown> | null = null;

  for (let index = 0; index < 3; index += 1) {
    const response = await post('/auth/phone-login', {
      phoneNumber,
      password: `${password}-rate-limit-${index}`
    }, undefined, forwardedFor);
    if (response.status === 429) {
      limited = response;
      break;
    }
    assert(response.status === 401, `phone-login pre-limit attempt should be 401, got ${response.status}`);
    assert(!response.cookie, 'phone-login pre-limit wrong-password attempt must not issue a session cookie');
  }

  assert(limited?.status === 429, 'phone-login should rate limit repeated phone attempts');
  assert(!limited.cookie, 'rate-limited phone-login must not issue a session cookie');
  checks.push('phone_login_rate_limits_repeated_phone_attempts');
}

async function verifyPasswordRecoveryRateLimit(phoneNumber: string, forwardedFor: string) {
  let limited: HttpResult<unknown> | null = null;

  for (let index = 0; index < 4; index += 1) {
    const response = await post<RecoveryRequestResponse | ErrorResponse>('/auth/password-recovery/request', {
      phoneNumber
    }, undefined, forwardedFor);
    if (response.status === 429) {
      limited = response;
      break;
    }
    assert(response.status >= 200 && response.status < 300, `password recovery pre-limit request should be 2xx, got ${response.status}`);
    assertRecoveryRequest(response.json as RecoveryRequestResponse, 'password-recovery/request pre-limit');
  }

  assert(limited?.status === 429, 'password recovery should rate limit repeated requests');
  checks.push('password-recovery/request_rate_limits_repeated_requests');
}

async function verifyPasswordResetRateLimit(phoneNumber: string, forwardedFor: string) {
  let limited: HttpResult<unknown> | null = null;

  for (let index = 0; index < 5; index += 1) {
    const response = await post<ErrorResponse>('/auth/password-recovery/reset', {
      phoneNumber,
      verificationCode: '123456',
      newPassword: `NewPassw0rd!${index}`
    }, undefined, forwardedFor);
    if (response.status === 429) {
      limited = response;
      break;
    }
    assert(response.status === 400, `password reset pre-limit wrong-code request should be 400, got ${response.status}`);
    const resetMessage = extractErrorMessage(response.json);
    assert(resetMessage.toLowerCase().includes('invalid'), 'password reset pre-limit response should stay generic invalid-code');
  }

  assert(limited?.status === 429, 'password reset should rate limit repeated wrong-code attempts');
  checks.push('password-recovery-reset_rate_limits_repeated_attempts');
}

function assertRecoveryRequest(body: RecoveryRequestResponse, scope: string) {
  if (body.ok === true && body.channel === 'phone' && typeof body.providerConfigured === 'boolean' && !!body.message) {
    return;
  }

  assert(false, `${scope} contract drift: expected ok/channel/providerConfigured/message recovery fields`);
}

function expectProductVibecodingResponse(
  scope: string,
  product: ProductResponse,
  expected?: { quotaHours?: number | null; quotaPeriodDays?: number | null; tokenQuota?: number | null }
) {
  const missing: string[] = [];

  if (!hasField(product, 'productKind')) {
    missing.push('productKind');
  } else if (product.productKind !== 'vibe_coding') {
    missing.push('productKind mismatch');
  }
  if (!hasField(product, 'quotaHours')) {
    missing.push('quotaHours');
  }
  if (!hasField(product, 'quotaPeriodDays')) {
    missing.push('quotaPeriodDays');
  }
  if (!hasField(product, 'tokenQuota') && !hasField(product, 'tokenQuotaCents')) {
    missing.push('tokenQuota');
  }

  if (expected) {
    if (typeof expected.quotaHours === 'number' && product.quotaHours !== expected.quotaHours) {
      missing.push(`quotaHours expected ${expected.quotaHours}`);
    }
    if (typeof expected.quotaPeriodDays === 'number' && product.quotaPeriodDays !== expected.quotaPeriodDays) {
      missing.push(`quotaPeriodDays expected ${expected.quotaPeriodDays}`);
    }
    if (typeof expected.tokenQuota === 'number' && product.tokenQuota !== expected.tokenQuota) {
      if (product.tokenQuota === null || product.tokenQuota === undefined) {
        missing.push('tokenQuota value mismatch');
      } else if (product.tokenQuota > expected.tokenQuota) {
        missing.push(`tokenQuota expected <= ${expected.tokenQuota}`);
      }
    }
  }

  if (missing.length === 0) {
    checks.push(`${scope} response exposes vibecoding fields`);
    return true;
  }

  checkTodo(`${scope} response for ${product.id} missing vibecoding fields: ${missing.join(', ')}`);
  return false;
}

function expectProductVibecodingDb(
  scope: string,
  productId: string,
  dbProduct: { productKind: string; quotaHours: number | null; quotaPeriodDays: number | null; tokenQuota: number | null } | null,
  expected?: { quotaHours?: number | null; quotaPeriodDays?: number | null; tokenQuota?: number | null }
) {
  if (!dbProduct) {
    checkTodo(`${scope} DB record for product ${productId} not found`);
    return;
  }

  const missing: string[] = [];
  if (dbProduct.productKind !== 'VIBE_CODING') {
    missing.push('productKind');
  }
  if (dbProduct.quotaHours === null || dbProduct.quotaHours === undefined) {
    missing.push('quotaHours');
  }
  if (dbProduct.quotaPeriodDays === null || dbProduct.quotaPeriodDays === undefined) {
    missing.push('quotaPeriodDays');
  }
  if (dbProduct.tokenQuota === null || dbProduct.tokenQuota === undefined) {
    missing.push('tokenQuota');
  }

  if (expected) {
    if (typeof expected.quotaHours === 'number' && dbProduct.quotaHours !== expected.quotaHours) {
      missing.push(`quotaHours expected ${expected.quotaHours}`);
    }
    if (typeof expected.quotaPeriodDays === 'number' && dbProduct.quotaPeriodDays !== expected.quotaPeriodDays) {
      missing.push(`quotaPeriodDays expected ${expected.quotaPeriodDays}`);
    }
    if (typeof expected.tokenQuota === 'number' && dbProduct.tokenQuota !== expected.tokenQuota) {
      missing.push(`tokenQuota expected ${expected.tokenQuota}`);
    }
  }

  if (missing.length === 0) {
    checks.push(`${scope} DB persistence includes vibecoding fields`);
    return;
  }

  checkTodo(`${scope} DB persistence for product ${productId} missing ${missing.join(', ')}`);
}

function extractLeaderboardEntries(payload: UsageLeaderboardResponse | unknown) {
  const root = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const rows = Array.isArray(root.items)
    ? root.items
    : [];

  return rows
    .map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const typed = entry as UsageLeaderboardItem;
      const userId = normalizeId(typed.userId);
      const totalTokens = normalizeTokens(typed.totalTokens, undefined, typed.totalTokens);
      return { userId, totalTokens, rank: typed.rank ?? 0 };
    })
    .filter((entry): entry is { userId: string | null; totalTokens: number; rank: number } => entry !== null);
}

function normalizeId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : '';
}

function normalizeTokens(values: unknown, usage: unknown, fallbackUsageTotal: unknown) {
  if (typeof values === 'number' && Number.isFinite(values)) {
    return values;
  }
  if (typeof usage === 'object' && usage !== null) {
    const usageObj = usage as { totalTokens?: unknown };
    if (typeof usageObj.totalTokens === 'number' && Number.isFinite(usageObj.totalTokens)) {
      return usageObj.totalTokens;
    }
  }
  if (typeof fallbackUsageTotal === 'number' && Number.isFinite(fallbackUsageTotal)) {
    return fallbackUsageTotal;
  }
  return 0;
}

function extractErrorMessage(error: ErrorResponse) {
  return (
    error.message ??
    error.error?.message ??
    error.error?.code ??
    'unknown error'
  );
}

function normalizeUserTokens(entry: { usage?: { totalTokens?: number } | undefined }) {
  const direct = entry.usage?.totalTokens;
  if (typeof direct === 'number') {
    return direct;
  }
  return 0;
}

async function createUsageEvent(userId: string, tokenId: string, providerId: string, totalTokens: number) {
  const requestId = `${prefix}_usage_${tokenId.slice(0, 6)}_${randomBytes(2).toString('hex')}`;
  await prisma.usageEvent.create({
    data: {
      requestId,
      userId,
      tokenId,
      upstreamProviderId: providerId,
      model: usageSeed.model,
      upstreamModel: usageSeed.model,
      status: UsageEventStatus.BILLABLE,
      totalTokens,
      promptTokens: Math.floor(totalTokens / 2),
      completionTokens: totalTokens - Math.floor(totalTokens / 2),
      priceSnapshot: {},
      costCents: 0
    }
  });
}

async function register(username: string, phoneNumber?: string) {
  const payload: Record<string, string> = { username, password };
  if (phoneNumber) {
    payload.phoneNumber = phoneNumber;
  }
  const result = await post<RegisterResponse>('/auth/register', payload);
  assert(result.status === 200 || result.status === 201, `register ${username} failed with ${result.status}`);
  assert(result.cookie, `register ${username} did not return session cookie`);
  return {
    cookie: result.cookie!,
    userId: result.json.user.id,
    username: result.json.user.username
  };
}

async function getUserByUsername(username: string) {
  return prisma.user.findUniqueOrThrow({
    where: { username },
    select: {
      id: true,
      username: true
    }
  });
}

async function get<T>(path: string, cookie?: string, forwardedFor?: string) {
  return request<T>('GET', path, undefined, cookie, forwardedFor);
}

async function post<T = unknown>(path: string, body: unknown, cookie?: string, forwardedFor?: string) {
  return request<T>('POST', path, body, cookie, forwardedFor);
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  cookieOrUndefined?: string,
  forwardedFor?: string
): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookieOrUndefined ? { cookie: cookieOrUndefined } : {}),
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {})
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
    headers: response.headers,
    text,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

function hasField(product: ProductResponse, field: string) {
  const has = Object.prototype.hasOwnProperty.call(product, field);
  const value = (product as Record<string, unknown>)[field];
  if (!has) {
    return false;
  }

  if (field === 'tokenQuota' || field === 'tokenQuotaCents') {
    return value === null || typeof value === 'number';
  }
  if (field === 'productKind') {
    return typeof value === 'string' && value.length > 0;
  }
  if (field === 'quotaHours' || field === 'quotaPeriodDays') {
    return value === null || typeof value === 'number';
  }
  return true;
}

function checkTodo(message: string) {
  throw new Error(`T30 hard gate failed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup(
  adminId: string | null,
  providerId: string | null,
  tokenAId: string | null,
  tokenBId: string | null,
  productIds: Array<string | null>,
  ...usernames: string[]
) {
  const tokenIds = [tokenAId, tokenBId].filter(Boolean) as string[];
  const aiRechargeProductIds = productIds.filter(Boolean) as string[];
  const userList = await prisma.user.findMany({
    where: { username: { in: usernames } },
    select: { id: true }
  });
  const userIds = userList.map((user) => user.id);

  if (tokenIds.length) {
    const usageByToken = await prisma.usageEvent.findMany({
      where: { tokenId: { in: tokenIds } },
      select: { id: true }
    });
    await prisma.usageEvent.deleteMany({
      where: { id: { in: usageByToken.map((entry) => entry.id) } }
    });
    await prisma.apiTokenModelAccess.deleteMany({
      where: { apiTokenId: { in: tokenIds } }
    });
    await prisma.apiToken.deleteMany({ where: { id: { in: tokenIds } } });
  }

  if (providerId) {
    await prisma.upstreamModel.deleteMany({ where: { providerId } });
    await prisma.upstreamProvider.deleteMany({ where: { id: providerId } });
  }

  if (aiRechargeProductIds.length) {
    await prisma.vibeCodingEntitlement.deleteMany({
      where: { sourceAiRechargeOrder: { productId: { in: aiRechargeProductIds } } }
    });
    await prisma.aiRechargeOrder.deleteMany({ where: { productId: { in: aiRechargeProductIds } } });
    await prisma.aiRechargeProduct.deleteMany({ where: { id: { in: aiRechargeProductIds } } });
  }

  if (userIds.length) {
    await prisma.vibeCodingEntitlement.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          ...(aiRechargeProductIds.length
            ? [{ sourceAiRechargeOrder: { productId: { in: aiRechargeProductIds } } }]
            : [])
        ]
      }
    });
    await prisma.aiRechargeOrder.deleteMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          ...(aiRechargeProductIds.length ? [{ productId: { in: aiRechargeProductIds } }] : [])
        ]
      }
    });
    await prisma.requestLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.usageEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.relayRateLimitEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityAuditLog.deleteMany({
      where: {
        action: { in: authAttemptActions },
        createdAt: { gte: scriptStartedAt }
      }
    });
    await prisma.apiTokenModelAccess.deleteMany({
      where: { apiToken: { userId: { in: userIds } } }
    });
    await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.walletTransaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId: { in: userIds } } });
    await prisma.adminAuditLog.deleteMany({ where: { targetId: { in: userIds } } });
    await prisma.securityAuditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  if (adminId) {
    await prisma.user.deleteMany({ where: { id: adminId } });
  }
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
