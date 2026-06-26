import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  AiRechargeProductKind,
  AiRechargeOrderStatus,
  AiRechargeProductStatus,
  Prisma
} from '../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { normalizeTranslations, resolveLocalizedText } from '../i18n/localized-content';
import { PrismaService } from '../prisma.service';

type ProductInput = {
  productKind?: unknown;
  title?: unknown;
  platform?: unknown;
  planName?: unknown;
  durationDays?: unknown;
  quotaHours?: unknown;
  quotaPeriodDays?: unknown;
  tokenQuota?: unknown;
  priceCnyCents?: unknown;
  description?: unknown;
  purchaseNote?: unknown;
  deliveryNote?: unknown;
  sortOrder?: unknown;
  status?: unknown;
  translations?: unknown;
};

type OrderInput = {
  productId?: unknown;
  customerAccount?: unknown;
  customerContact?: unknown;
  customerNote?: unknown;
};

type OrderStatusInput = {
  status?: unknown;
  merchantNote?: unknown;
};

type PageConfigInput = {
  introTitle?: unknown;
  introContent?: unknown;
  introImageDataUrl?: unknown;
  translations?: unknown;
};

const ORDER_PREFIX = 'AIR';
const ORDER_BYTES = 6;
const ORDER_COLLISION_RETRIES = 5;
const MAX_PRICE_CNY_CENTS = 1_000_000_00;
const MAX_TOKEN_QUOTA = 2_000_000_000;
const PAGE_CONFIG_ID = 'default';
const MAX_INTRO_IMAGE_DATA_URL_LENGTH = 1_500_000;
const PRODUCT_TRANSLATION_RULES = {
  title: 80,
  platform: 60,
  planName: 80,
  description: 1000,
  purchaseNote: 1000,
  deliveryNote: 1000
};
const PAGE_CONFIG_TRANSLATION_RULES = {
  introTitle: 80,
  introContent: 2000
};

@Injectable()
export class AiRechargeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPageConfig(language?: string | null, options: { includeTranslations?: boolean } = {}) {
    const config = await this.prisma.aiRechargePageConfig.findUnique({
      where: { id: PAGE_CONFIG_ID }
    });

    return this.toPageConfig(config, language, options);
  }

  async updatePageConfig(adminUserId: string, body: PageConfigInput) {
    const input = this.parsePageConfigInput(body);
    const existing = await this.prisma.aiRechargePageConfig.findUnique({
      where: { id: PAGE_CONFIG_ID }
    });

    const config = await this.prisma.aiRechargePageConfig.upsert({
      where: { id: PAGE_CONFIG_ID },
      update: {
        ...input,
        updatedByAdminId: adminUserId
      },
      create: {
        id: PAGE_CONFIG_ID,
        ...input,
        updatedByAdminId: adminUserId
      }
    });

    await this.writeAdminAudit(adminUserId, 'ai_recharge_page_config_updated', 'ai_recharge_page_config', null, existing ? {
      introTitle: existing.introTitle,
      introContent: existing.introContent,
      hasIntroImage: Boolean(existing.introImageDataUrl),
      hasTranslations: Boolean(existing.translations)
    } : null, {
      introTitle: config.introTitle,
      introContent: config.introContent,
      hasIntroImage: Boolean(config.introImageDataUrl),
      hasTranslations: Boolean(config.translations)
    });

    return this.toPageConfig(config, null, { includeTranslations: true });
  }

  async listPublicProducts(language?: string | null) {
    const products = await this.prisma.aiRechargeProduct.findMany({
      where: { status: AiRechargeProductStatus.ACTIVE },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }]
    });

    return {
      items: products.map((product) => this.toProduct(product, language))
    };
  }

  async listAdminProducts() {
    const products = await this.prisma.aiRechargeProduct.findMany({
      include: {
        createdByAdmin: { select: { username: true } },
        _count: { select: { orders: true } }
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }]
    });

    return {
      items: products.map((product) => ({
        ...this.toProduct(product, null, { includeTranslations: true }),
        createdBy: product.createdByAdmin.username,
        orderCount: product._count.orders
      }))
    };
  }

  async createProduct(adminUserId: string, body: ProductInput) {
    const input = this.parseProductInput(body);
    const product = await this.prisma.aiRechargeProduct.create({
      data: {
        ...input,
        createdByAdminId: adminUserId
      }
    });

    await this.writeAdminAudit(adminUserId, 'ai_recharge_product_created', 'ai_recharge_product', product.id, null, {
      id: product.id,
      productKind: product.productKind.toLowerCase(),
      title: product.title,
      platform: product.platform,
      planName: product.planName,
      quotaHours: product.quotaHours,
      quotaPeriodDays: product.quotaPeriodDays,
      tokenQuota: product.tokenQuota,
      priceCnyCents: product.priceCnyCents,
      status: product.status.toLowerCase(),
      hasTranslations: Boolean(product.translations)
    });

    return this.toProduct(product, null, { includeTranslations: true });
  }

  async updateProduct(adminUserId: string, productId: string, body: ProductInput) {
    const id = this.requiredUuid(productId, 'productId');
    const existing = await this.prisma.aiRechargeProduct.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('代充商品不存在');
    }

    const input = this.parseProductInput(body);
    const product = await this.prisma.aiRechargeProduct.update({
      where: { id },
      data: input
    });

    await this.writeAdminAudit(adminUserId, 'ai_recharge_product_updated', 'ai_recharge_product', product.id, {
      title: existing.title,
      productKind: existing.productKind.toLowerCase(),
      platform: existing.platform,
      planName: existing.planName,
      quotaHours: existing.quotaHours,
      quotaPeriodDays: existing.quotaPeriodDays,
      tokenQuota: existing.tokenQuota,
      priceCnyCents: existing.priceCnyCents,
      status: existing.status.toLowerCase(),
      hasTranslations: Boolean(existing.translations)
    }, {
      title: product.title,
      productKind: product.productKind.toLowerCase(),
      platform: product.platform,
      planName: product.planName,
      quotaHours: product.quotaHours,
      quotaPeriodDays: product.quotaPeriodDays,
      tokenQuota: product.tokenQuota,
      priceCnyCents: product.priceCnyCents,
      status: product.status.toLowerCase(),
      hasTranslations: Boolean(product.translations)
    });

    return this.toProduct(product, null, { includeTranslations: true });
  }

  async updateProductStatus(adminUserId: string, productId: string, body: ProductInput) {
    const id = this.requiredUuid(productId, 'productId');
    const existing = await this.prisma.aiRechargeProduct.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('代充商品不存在');
    }

    const status = this.normalizeProductStatus(body.status);
    const product = await this.prisma.aiRechargeProduct.update({
      where: { id },
      data: { status }
    });

    await this.writeAdminAudit(adminUserId, 'ai_recharge_product_status_updated', 'ai_recharge_product', product.id, {
      status: existing.status.toLowerCase()
    }, {
      status: product.status.toLowerCase()
    });

    return this.toProduct(product, null, { includeTranslations: true });
  }

  async deleteProduct(adminUserId: string, productId: string) {
    const id = this.requiredUuid(productId, 'productId');
    const existing = await this.prisma.aiRechargeProduct.findUnique({
      where: { id },
      include: { _count: { select: { orders: true } } }
    });
    if (!existing) {
      throw new NotFoundException('代充商品不存在');
    }

    if (existing._count.orders > 0) {
      throw new ConflictException('该商品已有订单，不能删除；请下架保留历史记录');
    }

    await this.prisma.aiRechargeProduct.delete({ where: { id } });
    await this.writeAdminAudit(adminUserId, 'ai_recharge_product_deleted', 'ai_recharge_product', id, {
      id,
      title: existing.title,
      productKind: existing.productKind.toLowerCase(),
      platform: existing.platform,
      planName: existing.planName,
      quotaHours: existing.quotaHours,
      quotaPeriodDays: existing.quotaPeriodDays,
      tokenQuota: existing.tokenQuota,
      priceCnyCents: existing.priceCnyCents,
      status: existing.status.toLowerCase()
    }, null);

    return { id, deleted: true };
  }

  async createOrder(user: AuthenticatedUser, body: OrderInput) {
    const productId = this.requiredUuid(this.requiredString(body.productId, 'productId'), 'productId');
    const customerAccount = this.normalizedRequiredText(body.customerAccount, '账号信息', 160);
    const customerContact = this.normalizedRequiredText(body.customerContact, '联系方式', 160);
    const customerNote = this.optionalText(body.customerNote, 1000);

    const product = await this.prisma.aiRechargeProduct.findFirst({
      where: {
        id: productId,
        status: AiRechargeProductStatus.ACTIVE
      }
    });
    if (!product) {
      throw new NotFoundException('代充商品不存在或已下架');
    }

    const order = await this.createOrderWithRetry({
      userId: user.id,
      productId: product.id,
      productTitleSnapshot: product.title,
      platformSnapshot: product.platform,
      planNameSnapshot: product.planName,
      amountCnyCents: product.priceCnyCents,
      customerAccount,
      customerContact,
      customerNote
    });

    return {
      order: this.toOrder(order)
    };
  }

  async listUserOrders(user: AuthenticatedUser) {
    const orders = await this.prisma.aiRechargeOrder.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    return {
      items: orders.map((order) => this.toOrder(order))
    };
  }

  async listAdminOrders() {
    const orders = await this.prisma.aiRechargeOrder.findMany({
      include: {
        user: { select: { username: true } },
        product: { select: { title: true, status: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });

    return {
      items: orders.map((order) => ({
        ...this.toOrder(order),
        username: order.user.username,
        currentProductTitle: order.product.title,
        currentProductStatus: order.product.status.toLowerCase()
      }))
    };
  }

  async updateOrderStatus(adminUserId: string, orderId: string, body: OrderStatusInput) {
    const id = this.requiredUuid(orderId, 'orderId');
    const existing = await this.prisma.aiRechargeOrder.findUnique({
      where: { id },
      include: {
        product: true,
        vibeCodingEntitlement: true
      }
    });
    if (!existing) {
      throw new NotFoundException('代充订单不存在');
    }

    const status = this.normalizeOrderStatus(body.status);
    const merchantNote = this.optionalText(body.merchantNote, 1000);
    const order = await this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.aiRechargeOrder.update({
        where: { id },
        data: {
          status,
          merchantNote
        },
        include: {
          vibeCodingEntitlement: true
        }
      });

      if (
        status === AiRechargeOrderStatus.FULFILLED &&
        existing.product.productKind === AiRechargeProductKind.VIBE_CODING &&
        !updatedOrder.vibeCodingEntitlement
      ) {
        const quotaPeriodDays = this.requiredPositivePackageInt(existing.product.quotaPeriodDays, 'quotaPeriodDays');
        const startsAt = new Date();
        await tx.vibeCodingEntitlement.create({
          data: {
            userId: existing.userId,
            sourceAiRechargeOrderId: existing.id,
            quotaHours: this.requiredPositivePackageInt(existing.product.quotaHours, 'quotaHours'),
            quotaPeriodDays,
            tokenQuota: this.requiredPositivePackageInt(existing.product.tokenQuota, 'tokenQuota'),
            startsAt,
            expiresAt: this.addDays(startsAt, quotaPeriodDays)
          }
        });
      }

      return tx.aiRechargeOrder.findUniqueOrThrow({ where: { id } });
    });

    await this.writeAdminAudit(adminUserId, 'ai_recharge_order_status_updated', 'ai_recharge_order', order.id, {
      orderNo: existing.orderNo,
      status: existing.status.toLowerCase()
    }, {
      orderNo: order.orderNo,
      status: order.status.toLowerCase()
    });

    return this.toOrder(order);
  }

  private async createOrderWithRetry(data: {
    userId: string;
    productId: string;
    productTitleSnapshot: string;
    platformSnapshot: string;
    planNameSnapshot: string;
    amountCnyCents: number;
    customerAccount: string;
    customerContact: string;
    customerNote: string | null;
  }) {
    let lastError: unknown;

    for (let attempt = 0; attempt < ORDER_COLLISION_RETRIES; attempt += 1) {
      try {
        return await this.prisma.aiRechargeOrder.create({
          data: {
            ...data,
            orderNo: this.generateOrderNo()
          }
        });
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }

        lastError = error;
      }
    }

    throw new ConflictException('代充订单号生成冲突，请重试', { cause: lastError });
  }

  private parseProductInput(body: ProductInput) {
    const productKind = this.normalizeProductKind(body.productKind ?? 'ai_recharge');
    const isVibeCoding = productKind === AiRechargeProductKind.VIBE_CODING;
    const quotaHoursInput = this.withVibeDefault(body.quotaHours, isVibeCoding ? 5 : null);
    const quotaPeriodDaysInput = this.withVibeDefault(body.quotaPeriodDays, isVibeCoding ? 7 : null);

    return {
      productKind,
      title: this.normalizedRequiredText(body.title, '商品标题', 80),
      platform: this.normalizedRequiredText(body.platform, '平台', 60),
      planName: this.normalizedRequiredText(body.planName, '套餐名称', 80),
      durationDays: this.optionalPositiveInt(body.durationDays, 'durationDays', 1, 3650),
      quotaHours: this.optionalPositiveInt(quotaHoursInput, 'quotaHours', 1, 100000),
      quotaPeriodDays: this.optionalPositiveInt(quotaPeriodDaysInput, 'quotaPeriodDays', 1, 3650),
      tokenQuota: this.optionalPositiveInt(body.tokenQuota, 'tokenQuota', 1, MAX_TOKEN_QUOTA),
      priceCnyCents: this.intInRange(body.priceCnyCents, 'priceCnyCents', 0, MAX_PRICE_CNY_CENTS),
      description: this.normalizedRequiredText(body.description, '商品介绍', 1000),
      purchaseNote: this.optionalText(body.purchaseNote, 1000),
      deliveryNote: this.optionalText(body.deliveryNote, 1000),
      ...this.parseTranslations(body.translations, PRODUCT_TRANSLATION_RULES),
      sortOrder: this.intInRange(body.sortOrder ?? 100, 'sortOrder', 0, 100000),
      status: this.normalizeProductStatus(body.status ?? 'active')
    };
  }

  private parsePageConfigInput(body: PageConfigInput) {
    return {
      introTitle: this.optionalText(body.introTitle, 80),
      introContent: this.optionalText(body.introContent, 2000),
      introImageDataUrl: this.optionalIntroImageDataUrl(body.introImageDataUrl),
      ...this.parseTranslations(body.translations, PAGE_CONFIG_TRANSLATION_RULES)
    };
  }

  private parseTranslations(value: unknown, rules: Record<string, number>) {
    const translations = normalizeTranslations(value, rules);
    return translations !== undefined ? { translations: translations ?? Prisma.DbNull } : {};
  }

  private withVibeDefault(value: unknown, defaultValue: number | null) {
    if (defaultValue === null) {
      return value;
    }
    return value === undefined || value === null || value === '' ? defaultValue : value;
  }

  private normalizeProductStatus(value: unknown) {
    const status = this.normalizedEnumText(value, 'status');
    if (status === 'active') {
      return AiRechargeProductStatus.ACTIVE;
    }
    if (status === 'disabled') {
      return AiRechargeProductStatus.DISABLED;
    }
    throw new BadRequestException('status must be active or disabled');
  }

  private normalizeProductKind(value: unknown) {
    const kind = this.normalizedEnumText(value, 'productKind');
    if (kind === 'ai_recharge') {
      return AiRechargeProductKind.AI_RECHARGE;
    }
    if (kind === 'vibe_coding') {
      return AiRechargeProductKind.VIBE_CODING;
    }
    throw new BadRequestException('productKind must be ai_recharge or vibe_coding');
  }

  private normalizeOrderStatus(value: unknown) {
    const status = this.normalizedEnumText(value, 'status');
    const statusMap: Record<string, AiRechargeOrderStatus> = {
      pending: AiRechargeOrderStatus.PENDING,
      processing: AiRechargeOrderStatus.PROCESSING,
      fulfilled: AiRechargeOrderStatus.FULFILLED,
      canceled: AiRechargeOrderStatus.CANCELED,
      failed: AiRechargeOrderStatus.FAILED
    };
    const normalized = statusMap[status];
    if (!normalized) {
      throw new BadRequestException('status must be pending, processing, fulfilled, canceled, or failed');
    }
    return normalized;
  }

  private normalizedEnumText(value: unknown, field: string) {
    if (typeof value !== 'string') {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim().toLowerCase();
  }

  private normalizedRequiredText(value: unknown, field: string, maxLength: number) {
    const text = this.optionalText(value, maxLength);
    if (!text) {
      throw new BadRequestException(`${field}不能为空`);
    }
    return text;
  }

  private optionalText(value: unknown, maxLength: number) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new BadRequestException('字段必须是字符串');
    }
    const text = value.trim();
    if (!text) {
      return null;
    }
    if (text.length > maxLength) {
      throw new BadRequestException(`字段长度不能超过 ${maxLength}`);
    }
    return text;
  }

  private optionalIntroImageDataUrl(value: unknown) {
    const text = this.optionalText(value, MAX_INTRO_IMAGE_DATA_URL_LENGTH);
    if (!text) {
      return null;
    }

    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(text)) {
      throw new BadRequestException('introImageDataUrl must be a png, jpeg, webp, or gif data URL');
    }

    return text;
  }

  private requiredString(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }

  private optionalPositiveInt(value: unknown, field: string, min: number, max: number) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return this.intInRange(value, field, min, max);
  }

  private requiredPositivePackageInt(value: number | null, field: string) {
    if (!Number.isInteger(value) || value === null || value <= 0) {
      throw new BadRequestException(`${field} must be a positive integer for vibe_coding packages`);
    }

    return value;
  }

  private addDays(value: Date, days: number) {
    return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private intInRange(value: unknown, field: string, min: number, max: number) {
    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
      throw new BadRequestException(`${field} must be an integer between ${min} and ${max}`);
    }
    return numericValue;
  }

  private requiredUuid(value: string, field: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`${field} must be a valid UUID`);
    }
    return value;
  }

  private generateOrderNo() {
    return `${ORDER_PREFIX}${Date.now().toString(36).toUpperCase()}${randomBytes(ORDER_BYTES).toString('hex').toUpperCase()}`;
  }

  private toProduct(product: {
    id: string;
    productKind: AiRechargeProductKind;
    title: string;
    platform: string;
    planName: string;
    durationDays: number | null;
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
    priceCnyCents: number;
    description: string;
    purchaseNote: string | null;
    deliveryNote: string | null;
    translations?: unknown;
    sortOrder: number;
    status: AiRechargeProductStatus;
    createdAt: Date;
    updatedAt: Date;
  }, language?: string | null, options: { includeTranslations?: boolean } = {}) {
    const response = {
      id: product.id,
      productKind: product.productKind.toLowerCase(),
      title: resolveLocalizedText(product.translations, language, 'title', product.title),
      platform: resolveLocalizedText(product.translations, language, 'platform', product.platform),
      planName: resolveLocalizedText(product.translations, language, 'planName', product.planName),
      durationDays: product.durationDays,
      quotaHours: product.quotaHours,
      quotaPeriodDays: product.quotaPeriodDays,
      tokenQuota: product.tokenQuota,
      priceCnyCents: product.priceCnyCents,
      description: resolveLocalizedText(product.translations, language, 'description', product.description),
      purchaseNote: resolveLocalizedText(product.translations, language, 'purchaseNote', product.purchaseNote),
      deliveryNote: resolveLocalizedText(product.translations, language, 'deliveryNote', product.deliveryNote),
      sortOrder: product.sortOrder,
      status: product.status.toLowerCase(),
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString()
    };

    return options.includeTranslations
      ? {
          ...response,
          translations: product.translations ?? null
        }
      : response;
  }

  private toOrder(order: {
    id: string;
    orderNo: string;
    userId: string;
    productId: string;
    productTitleSnapshot: string;
    platformSnapshot: string;
    planNameSnapshot: string;
    amountCnyCents: number;
    customerAccount: string;
    customerContact: string;
    customerNote: string | null;
    merchantNote: string | null;
    status: AiRechargeOrderStatus;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      userId: order.userId,
      productId: order.productId,
      productTitle: order.productTitleSnapshot,
      platform: order.platformSnapshot,
      planName: order.planNameSnapshot,
      amountCnyCents: order.amountCnyCents,
      customerAccount: order.customerAccount,
      customerContact: order.customerContact,
      customerNote: order.customerNote,
      merchantNote: order.merchantNote,
      status: order.status.toLowerCase(),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString()
    };
  }

  private toPageConfig(config: {
    id: string;
    introTitle: string | null;
    introContent: string | null;
    introImageDataUrl: string | null;
    translations?: unknown;
    updatedAt: Date;
  } | null, language?: string | null, options: { includeTranslations?: boolean } = {}) {
    const response = {
      id: PAGE_CONFIG_ID,
      introTitle: resolveLocalizedText(config?.translations, language, 'introTitle', config?.introTitle ?? null),
      introContent: resolveLocalizedText(config?.translations, language, 'introContent', config?.introContent ?? null),
      introImageDataUrl: config?.introImageDataUrl ?? null,
      updatedAt: config?.updatedAt.toISOString() ?? null
    };

    return options.includeTranslations
      ? {
          ...response,
          translations: config?.translations ?? null
        }
      : response;
  }

  private async writeAdminAudit(
    adminUserId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    beforeSnapshot: Prisma.InputJsonValue | null,
    afterSnapshot: Prisma.InputJsonValue | null
  ) {
    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action,
        targetType,
        targetId,
        beforeSnapshot: beforeSnapshot ?? Prisma.JsonNull,
        afterSnapshot: afterSnapshot ?? Prisma.JsonNull
      }
    });
  }

  private isUniqueViolation(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
