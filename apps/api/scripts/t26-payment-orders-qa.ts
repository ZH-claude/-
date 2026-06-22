import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes } from 'node:crypto';
import {
  PaymentChannel,
  PaymentOrderStatus,
  PrismaClient,
  UserRole,
  WalletTransactionType
} from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  cookie?: string;
};

type PaymentOrderDto = {
  id: string;
  orderNo: string;
  channel: 'alipay' | 'wechat';
  status: string;
  amountCents: number;
  amountBaseTokens: number;
  faceValueCnyCents: number;
  providerTradeNo: string | null;
  qrCodeContent: string | null;
  walletTransactionId?: string | null;
};

type PaymentOrderResponse = {
  order: PaymentOrderDto;
  wallet?: { balanceCents: number; balanceBaseTokens: number };
  transaction?: { id: string; amountCents: number; balanceAfterCents: number } | null;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const DATABASE_URL = process.env.DATABASE_URL;
const FACE_VALUE_CNY_CENTS = 100;
const EXPECTED_BASE_TOKENS = 1_000_000;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T26 payment-orders QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const usernamePrefix = `qa_t26_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];
const knownPaymentOrderIds: string[] = [];

async function main() {
  const adminUsername = `${usernamePrefix}_admin`;
  const userUsername = `${usernamePrefix}_user`;

  let residualBeforeCleanup: Record<string, number> | null = null;

  try {
    const adminCookie = await register(adminUsername);
    const userCookie = await register(userUsername);

    await prisma.user.update({
      where: { username: adminUsername },
      data: { role: UserRole.ADMIN }
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { username: userUsername } });

    const created = await post<PaymentOrderResponse>(
      '/recharge/payments/orders',
      { amountCnyCents: FACE_VALUE_CNY_CENTS, channel: 'alipay' },
      userCookie
    );
    assert(created.status >= 200 && created.status < 300, `create payment order failed with ${created.status}`);
    assert(created.json.order.channel === 'alipay', 'created order channel mismatch');
    assert(created.json.order.status === 'pending', 'created order should be pending');
    assert(created.json.order.faceValueCnyCents === FACE_VALUE_CNY_CENTS, 'created order face value mismatch');
    assert(created.json.order.amountBaseTokens === EXPECTED_BASE_TOKENS, 'created order base token amount mismatch');
    assert(created.json.order.qrCodeContent?.includes(created.json.order.orderNo), 'created order should expose placeholder qr content');
    knownPaymentOrderIds.push(created.json.order.id);
    await assertWalletBalance(user.id, 0, 'creating payment order credited balance');
    checks.push('user_creates_pending_payment_order_without_credit');

    const getOrder = await get<PaymentOrderResponse>(
      `/recharge/payments/orders/${encodeURIComponent(created.json.order.orderNo)}`,
      userCookie
    );
    assert(getOrder.status === 200, `get user payment order failed with ${getOrder.status}`);
    assert(getOrder.json.order.id === created.json.order.id, 'get user payment order returned wrong order');
    checks.push('user_reads_own_payment_order');

    const listOrders = await get<{ items: PaymentOrderDto[] }>('/recharge/payments/orders', userCookie);
    assert(listOrders.status === 200, `list user payment orders failed with ${listOrders.status}`);
    assert(listOrders.json.items.some((entry) => entry.id === created.json.order.id), 'list user payment orders missed order');
    checks.push('user_lists_payment_orders');

    const userMockBlocked = await post(
      `/admin/payment-orders/${encodeURIComponent(created.json.order.orderNo)}/mock-success`,
      {},
      userCookie
    );
    assert(userMockBlocked.status === 403, `ordinary user mock success should be 403, got ${userMockBlocked.status}`);
    await assertWalletBalance(user.id, 0, 'blocked user mock success credited balance');
    checks.push('admin_guard_blocks_mock_success');

    const providerPlaceholder = await post<{ accepted: boolean; code: string }>(
      '/payment-notify/alipay',
      { out_trade_no: created.json.order.orderNo },
      undefined
    );
    assert(providerPlaceholder.status >= 200 && providerPlaceholder.status < 300, `provider placeholder failed with ${providerPlaceholder.status}`);
    assert(providerPlaceholder.json.accepted === false, 'provider placeholder should not accept unconfigured callback');
    assert(providerPlaceholder.json.code === 'payment_provider_not_configured', 'provider placeholder code mismatch');
    await assertWalletBalance(user.id, 0, 'unconfigured provider callback credited balance');
    checks.push('unconfigured_provider_callback_does_not_credit');

    const paid = await post<PaymentOrderResponse>(
      `/admin/payment-orders/${encodeURIComponent(created.json.order.orderNo)}/mock-success`,
      {},
      adminCookie
    );
    assert(paid.status >= 200 && paid.status < 300, `admin mock success failed with ${paid.status}`);
    assert(paid.json.order.status === 'paid', 'paid order status mismatch');
    assert(paid.json.wallet?.balanceCents === EXPECTED_BASE_TOKENS, 'paid order wallet balance mismatch');
    assert(paid.json.transaction?.amountCents === EXPECTED_BASE_TOKENS, 'paid order transaction amount mismatch');
    await assertWalletBalance(user.id, EXPECTED_BASE_TOKENS, 'admin mock success did not credit balance');

    const dbOrder = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: created.json.order.id } });
    assert(dbOrder.status === PaymentOrderStatus.PAID, 'DB payment order status mismatch');
    assert(dbOrder.channel === PaymentChannel.ALIPAY, 'DB payment order channel mismatch');
    assert(dbOrder.providerTradeNo?.startsWith('MOCK-'), 'DB payment order provider trade number missing');

    const paymentTransaction = await prisma.walletTransaction.findFirstOrThrow({
      where: {
        userId: user.id,
        paymentOrderId: created.json.order.id,
        type: WalletTransactionType.RECHARGE
      }
    });
    assert(paymentTransaction.amountCents === EXPECTED_BASE_TOKENS, 'payment transaction amount mismatch');
    assert(paymentTransaction.rechargeCodeId === null, 'payment transaction should not reference recharge code');
    assert(paymentTransaction.idempotencyKey === `payment:${created.json.order.id}`, 'payment idempotency key mismatch');
    checks.push('admin_mock_success_credits_wallet_and_ledger');

    const duplicatePaid = await post<PaymentOrderResponse>(
      `/admin/payment-orders/${encodeURIComponent(created.json.order.orderNo)}/mock-success`,
      {},
      adminCookie
    );
    assert(duplicatePaid.status >= 200 && duplicatePaid.status < 300, `duplicate mock success failed with ${duplicatePaid.status}`);
    await assertWalletBalance(user.id, EXPECTED_BASE_TOKENS, 'duplicate mock success credited balance twice');
    const transactionCount = await prisma.walletTransaction.count({
      where: { paymentOrderId: created.json.order.id }
    });
    assert(transactionCount === 1, `duplicate mock success created ${transactionCount} transactions`);
    checks.push('duplicate_mock_success_is_idempotent');

    const wechat = await post<PaymentOrderResponse>(
      '/recharge/payments/orders',
      { amountCnyCents: FACE_VALUE_CNY_CENTS * 2, channel: 'wechat' },
      userCookie
    );
    assert(wechat.status >= 200 && wechat.status < 300, `wechat order create failed with ${wechat.status}`);
    assert(wechat.json.order.channel === 'wechat', 'wechat order channel mismatch');
    assert(wechat.json.order.status === 'pending', 'wechat order should remain pending');
    knownPaymentOrderIds.push(wechat.json.order.id);
    await assertWalletBalance(user.id, EXPECTED_BASE_TOKENS, 'pending wechat order changed balance');
    checks.push('wechat_pending_order_does_not_credit');

    const records = await get<{
      items: Array<{
        paymentOrderId: string | null;
        paymentOrderNo: string | null;
        paymentChannel: string | null;
        faceValueCnyCents: number | null;
        amountBaseTokens: number;
      }>;
    }>('/recharge/records', userCookie);
    assert(records.status === 200, `recharge records failed with ${records.status}`);
    assert(
      records.json.items.some(
        (entry) =>
          entry.paymentOrderId === created.json.order.id &&
          entry.paymentOrderNo === created.json.order.orderNo &&
          entry.paymentChannel === 'alipay' &&
          entry.faceValueCnyCents === FACE_VALUE_CNY_CENTS &&
          entry.amountBaseTokens === EXPECTED_BASE_TOKENS
      ),
      'recharge records did not expose paid payment order'
    );
    checks.push('payment_order_appears_in_recharge_records');

    const adminList = await get<{ items: Array<PaymentOrderDto & { username?: string }> }>('/admin/payment-orders', adminCookie);
    assert(adminList.status === 200, `admin payment order list failed with ${adminList.status}`);
    assert(adminList.json.items.some((entry) => entry.id === created.json.order.id && entry.username === userUsername), 'admin list missed payment order');
    checks.push('admin_lists_payment_orders');

    residualBeforeCleanup = await countResidual(usernamePrefix);

    console.log(
      JSON.stringify(
        {
          ok: true,
          suffix,
          checks,
          paymentOrderCount: knownPaymentOrderIds.length,
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
    payment_orders: await prisma.paymentOrder.count({
      where: {
        OR: [{ id: { in: knownPaymentOrderIds } }, { userId: { in: userIds } }]
      }
    }),
    wallet_transactions: await prisma.walletTransaction.count({
      where: {
        OR: [{ userId: { in: userIds } }, { paymentOrderId: { in: knownPaymentOrderIds } }]
      }
    }),
    admin_audit_logs: await prisma.adminAuditLog.count({
      where: {
        OR: [{ adminUserId: { in: userIds } }, { targetId: { in: knownPaymentOrderIds } }]
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
      OR: [{ adminUserId: { in: userIds } }, { targetId: { in: knownPaymentOrderIds } }]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: {
      OR: [{ userId: { in: userIds } }, { paymentOrderId: { in: knownPaymentOrderIds } }]
    }
  });
  await prisma.paymentOrder.deleteMany({
    where: {
      OR: [{ id: { in: knownPaymentOrderIds } }, { userId: { in: userIds } }]
    }
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
