import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  NotificationChannelType,
  NotificationDeliveryStatus,
  NotificationEventType,
  Prisma
} from '../generated/prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma.service';
import { decryptNotificationSecret, encryptNotificationSecret } from './notification-secret-crypto';
import { maskWebhookUrl, normalizeAndValidateWebhookUrl } from './webhook-url-safety';

type UpdateNotificationInput = {
  preference?: unknown;
  webhook?: unknown;
};

type WebhookPayload = {
  event: 'test' | 'balance_low';
  occurredAt: string;
  data: Record<string, unknown>;
};

type NotificationPreferenceShape = {
  userId: string;
  balanceLowEnabled: boolean;
  balanceLowThresholdCents: number | null;
  balanceLowLastNotifiedAt: Date | null;
  securityAlertsEnabled: boolean;
  systemAnnouncementsEnabled: boolean;
  promotionsEnabled: boolean;
  modelPriceUpdatesEnabled: boolean;
};

const MAX_THRESHOLD_CENTS = 100_000_000_000;
const WEBHOOK_TIMEOUT_MS = 8000;
const ERROR_MAX_LENGTH = 240;
const BALANCE_LOW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getSettings(user: AuthenticatedUser) {
    const [preference, channels, deliveries, wallet] = await Promise.all([
      this.prisma.notificationPreference.findUnique({
        where: { userId: user.id }
      }),
      this.prisma.notificationChannel.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' }
      }),
      this.prisma.notificationDelivery.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10
      }),
      this.prisma.wallet.findUnique({
        where: { userId: user.id },
        select: { balanceCents: true, totalSpendCents: true }
      })
    ]);

    return this.toSettingsResponse({
      preference: preference ?? this.defaultPreference(user.id),
      channels,
      deliveries,
      wallet: wallet ?? { balanceCents: 0, totalSpendCents: 0 }
    });
  }

  async updateSettings(user: AuthenticatedUser, input: UpdateNotificationInput) {
    const existingPreference = await this.prisma.notificationPreference.findUnique({
      where: { userId: user.id }
    });
    const existingWebhook = await this.prisma.notificationChannel.findUnique({
      where: {
        userId_type: {
          userId: user.id,
          type: NotificationChannelType.WEBHOOK
        }
      }
    });
    const preferenceInput = this.normalizePreferenceInput(input.preference, existingPreference ?? this.defaultPreference(user.id));
    const webhookInput = await this.normalizeWebhookInput(input.webhook, existingWebhook);

    await this.prisma.$transaction(async (tx) => {
      await tx.notificationPreference.upsert({
        where: { userId: user.id },
        update: preferenceInput,
        create: {
          userId: user.id,
          ...preferenceInput
        }
      });

      if (webhookInput) {
        await tx.notificationChannel.upsert({
          where: {
            userId_type: {
              userId: user.id,
              type: NotificationChannelType.WEBHOOK
            }
          },
          update: webhookInput,
          create: {
            userId: user.id,
            type: NotificationChannelType.WEBHOOK,
            name: webhookInput.name ?? 'Webhook',
            enabled: webhookInput.enabled ?? false,
            targetPreview: webhookInput.targetPreview ?? null,
            encryptedTarget: webhookInput.encryptedTarget ?? null
          }
        });
      }
    });

    return this.getSettings(user);
  }

  async testWebhook(user: AuthenticatedUser) {
    const channel = await this.prisma.notificationChannel.findUnique({
      where: {
        userId_type: {
          userId: user.id,
          type: NotificationChannelType.WEBHOOK
        }
      }
    });

    this.assertConfiguredWebhook(channel);

    const delivery = await this.deliverWebhook({
      userId: user.id,
      channel: {
        id: channel!.id,
        encryptedTarget: channel!.encryptedTarget!,
        targetPreview: channel!.targetPreview
      },
      eventType: NotificationEventType.TEST,
      payload: {
        event: 'test',
        occurredAt: new Date().toISOString(),
        data: {
          username: user.username,
          message: 'notification_settings_test'
        }
      },
      metadata: { source: 'manual_test' }
    });

    await this.prisma.notificationChannel.update({
      where: { id: channel!.id },
      data: {
        lastTestAt: delivery.createdAt,
        lastTestStatus: delivery.status,
        lastTestError: delivery.errorMessage
      }
    });

    if (delivery.status !== NotificationDeliveryStatus.SENT) {
      throw new BadRequestException({
        message: 'Webhook test failed',
        delivery: this.toPublicDelivery(delivery)
      });
    }

    return { delivery: this.toPublicDelivery(delivery) };
  }

  async sendBalanceLowIfNeeded(userId: string, balanceCents: number) {
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId }
    });

    if (!preference?.balanceLowEnabled || preference.balanceLowThresholdCents === null) {
      return { attempted: false, reason: 'balance_low_disabled' };
    }

    if (balanceCents > preference.balanceLowThresholdCents) {
      return { attempted: false, reason: 'balance_above_threshold' };
    }

    if (this.isInBalanceLowCooldown(preference.balanceLowLastNotifiedAt)) {
      return { attempted: false, reason: 'balance_low_cooldown' };
    }

    const channel = await this.prisma.notificationChannel.findUnique({
      where: {
        userId_type: {
          userId,
          type: NotificationChannelType.WEBHOOK
        }
      }
    });

    if (!channel?.enabled || !channel.encryptedTarget) {
      return { attempted: false, reason: 'webhook_not_configured' };
    }

    const delivery = await this.deliverWebhook({
      userId,
      channel: {
        id: channel.id,
        encryptedTarget: channel.encryptedTarget,
        targetPreview: channel.targetPreview
      },
      eventType: NotificationEventType.BALANCE_LOW,
      payload: {
        event: 'balance_low',
        occurredAt: new Date().toISOString(),
        data: {
          balanceCents,
          thresholdCents: preference.balanceLowThresholdCents
        }
      },
      metadata: {
        source: 'billing_debit',
        balanceCents,
        thresholdCents: preference.balanceLowThresholdCents
      }
    });

    await this.prisma.notificationPreference.update({
      where: { userId },
      data: { balanceLowLastNotifiedAt: delivery.createdAt }
    });

    return {
      attempted: true,
      status: delivery.status.toLowerCase(),
      deliveryId: delivery.id
    };
  }

  private async deliverWebhook(input: {
    userId: string;
    channel: {
      id: string;
      encryptedTarget: string;
      targetPreview: string | null;
    };
    eventType: NotificationEventType;
    payload: WebhookPayload;
    metadata: Prisma.InputJsonValue;
  }) {
    const webhookUrl = await normalizeAndValidateWebhookUrl(decryptNotificationSecret(input.channel.encryptedTarget));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    let responseStatus: number | null = null;
    let status: NotificationDeliveryStatus = NotificationDeliveryStatus.FAILED;
    let errorMessage: string | null = null;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'NestedApiRelayNotification/1.0'
        },
        body: JSON.stringify(input.payload),
        signal: controller.signal
      });
      responseStatus = response.status;
      await response.text().catch(() => undefined);
      status = response.ok ? NotificationDeliveryStatus.SENT : NotificationDeliveryStatus.FAILED;
      errorMessage = response.ok ? null : `HTTP ${response.status}`;
    } catch (error) {
      errorMessage = this.normalizeDeliveryError(error);
    } finally {
      clearTimeout(timeout);
    }

    return this.prisma.notificationDelivery.create({
      data: {
        userId: input.userId,
        channelId: input.channel.id,
        eventType: input.eventType,
        status,
        targetPreview: input.channel.targetPreview,
        responseStatus,
        errorMessage,
        metadata: input.metadata
      }
    });
  }

  private normalizePreferenceInput(
    value: unknown,
    current: {
      balanceLowEnabled: boolean;
      balanceLowThresholdCents: number | null;
      securityAlertsEnabled: boolean;
      systemAnnouncementsEnabled: boolean;
      promotionsEnabled: boolean;
      modelPriceUpdatesEnabled: boolean;
    }
  ) {
    const body = this.toRecord(value);
    const balanceLowEnabled = this.optionalBoolean(body.balanceLowEnabled, current.balanceLowEnabled);
    const balanceLowThresholdCents = this.optionalNonNegativeInt(
      body.balanceLowThresholdCents,
      'balanceLowThresholdCents',
      current.balanceLowThresholdCents,
      MAX_THRESHOLD_CENTS
    );

    if (balanceLowEnabled && balanceLowThresholdCents === null) {
      throw new BadRequestException('balanceLowThresholdCents is required when balance low alert is enabled');
    }

    return {
      balanceLowEnabled,
      balanceLowThresholdCents,
      securityAlertsEnabled: this.optionalBoolean(body.securityAlertsEnabled, current.securityAlertsEnabled),
      systemAnnouncementsEnabled: this.optionalBoolean(
        body.systemAnnouncementsEnabled,
        current.systemAnnouncementsEnabled
      ),
      promotionsEnabled: this.optionalBoolean(body.promotionsEnabled, current.promotionsEnabled),
      modelPriceUpdatesEnabled: this.optionalBoolean(body.modelPriceUpdatesEnabled, current.modelPriceUpdatesEnabled)
    };
  }

  private async normalizeWebhookInput(
    value: unknown,
    current: {
      encryptedTarget: string | null;
    } | null
  ) {
    if (value === undefined || value === null) {
      return null;
    }

    const body = this.toRecord(value);
    const enabled = this.optionalBoolean(body.enabled, false);
    const name = this.optionalText(body.name, 'name', 1, 80) ?? 'Webhook';
    const update: {
      name: string;
      enabled: boolean;
      targetPreview?: string | null;
      encryptedTarget?: string | null;
    } = { name, enabled };

    if ('url' in body) {
      const rawUrl = body.url;
      if (rawUrl === null || rawUrl === '') {
        update.targetPreview = null;
        update.encryptedTarget = null;
      } else {
        const normalizedUrl = await normalizeAndValidateWebhookUrl(rawUrl);
        update.targetPreview = maskWebhookUrl(normalizedUrl);
        update.encryptedTarget = encryptNotificationSecret(normalizedUrl);
      }
    }

    if (enabled && !update.encryptedTarget && !current?.encryptedTarget) {
      throw new BadRequestException('webhook.url is required before enabling webhook notifications');
    }

    return update;
  }

  private assertConfiguredWebhook(
    channel:
      | {
          id: string;
          enabled: boolean;
          encryptedTarget: string | null;
          targetPreview: string | null;
        }
      | null
  ): asserts channel is { id: string; enabled: boolean; encryptedTarget: string; targetPreview: string | null } {
    if (!channel?.enabled || !channel.encryptedTarget) {
      throw new BadRequestException('Webhook channel is not configured or enabled');
    }
  }

  private toSettingsResponse(input: {
    preference: NotificationPreferenceShape;
    channels: Array<{
      type: NotificationChannelType;
      name: string;
      enabled: boolean;
      targetPreview: string | null;
      encryptedTarget: string | null;
      lastTestStatus: NotificationDeliveryStatus | null;
      lastTestAt: Date | null;
      lastTestError: string | null;
    }>;
    deliveries: Array<{
      id: string;
      eventType: NotificationEventType;
      status: NotificationDeliveryStatus;
      targetPreview: string | null;
      responseStatus: number | null;
      errorMessage: string | null;
      createdAt: Date;
    }>;
    wallet: { balanceCents: number; totalSpendCents: number };
  }) {
    const webhook = input.channels.find((channel) => channel.type === NotificationChannelType.WEBHOOK) ?? null;

    return {
      wallet: input.wallet,
      preference: {
        balanceLowEnabled: input.preference.balanceLowEnabled,
        balanceLowThresholdCents: input.preference.balanceLowThresholdCents,
        balanceLowLastNotifiedAt: input.preference.balanceLowLastNotifiedAt?.toISOString() ?? null,
        securityAlertsEnabled: input.preference.securityAlertsEnabled,
        systemAnnouncementsEnabled: input.preference.systemAnnouncementsEnabled,
        promotionsEnabled: input.preference.promotionsEnabled,
        modelPriceUpdatesEnabled: input.preference.modelPriceUpdatesEnabled
      },
      channels: {
        webhook: webhook
          ? this.toPublicChannel(webhook)
          : {
              type: 'webhook',
              name: 'Webhook',
              enabled: false,
              configured: false,
              supported: true,
              targetPreview: null,
              lastTestStatus: null,
              lastTestAt: null,
              lastTestError: null
            },
        email: {
          type: 'email',
          name: 'Email',
          enabled: false,
          configured: false,
          supported: false,
          targetPreview: null,
          lastTestStatus: null,
          lastTestAt: null,
          lastTestError: 'email_sender_not_configured'
        }
      },
      deliveries: input.deliveries.map((delivery) => this.toPublicDelivery(delivery))
    };
  }

  private toPublicChannel(channel: {
    type: NotificationChannelType;
    name: string;
    enabled: boolean;
    targetPreview: string | null;
    encryptedTarget: string | null;
    lastTestStatus: NotificationDeliveryStatus | null;
    lastTestAt: Date | null;
    lastTestError: string | null;
  }) {
    return {
      type: channel.type.toLowerCase(),
      name: channel.name,
      enabled: channel.enabled,
      configured: Boolean(channel.encryptedTarget),
      supported: true,
      targetPreview: channel.targetPreview,
      lastTestStatus: channel.lastTestStatus?.toLowerCase() ?? null,
      lastTestAt: channel.lastTestAt?.toISOString() ?? null,
      lastTestError: channel.lastTestError
    };
  }

  private toPublicDelivery(delivery: {
    id: string;
    eventType: NotificationEventType;
    status: NotificationDeliveryStatus;
    targetPreview: string | null;
    responseStatus: number | null;
    errorMessage: string | null;
    createdAt: Date;
  }) {
    return {
      id: delivery.id,
      eventType: delivery.eventType.toLowerCase(),
      status: delivery.status.toLowerCase(),
      targetPreview: delivery.targetPreview,
      responseStatus: delivery.responseStatus,
      errorMessage: delivery.errorMessage,
      createdAt: delivery.createdAt.toISOString()
    };
  }

  private defaultPreference(userId: string) {
    return {
      id: '',
      userId,
      balanceLowEnabled: false,
      balanceLowThresholdCents: null,
      balanceLowLastNotifiedAt: null,
      securityAlertsEnabled: true,
      systemAnnouncementsEnabled: true,
      promotionsEnabled: false,
      modelPriceUpdatesEnabled: false,
      createdAt: new Date(0),
      updatedAt: new Date(0)
    };
  }

  private isInBalanceLowCooldown(lastNotifiedAt: Date | null) {
    return Boolean(lastNotifiedAt && Date.now() - lastNotifiedAt.getTime() < BALANCE_LOW_COOLDOWN_MS);
  }

  private normalizeDeliveryError(error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return 'Webhook request timed out';
    }

    if (error instanceof Error && error.message) {
      return this.truncateError(error.message);
    }

    return 'Webhook request failed';
  }

  private truncateError(message: string) {
    return message.length > ERROR_MAX_LENGTH ? `${message.slice(0, ERROR_MAX_LENGTH)}...` : message;
  }

  private toRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private optionalBoolean(value: unknown, defaultValue: boolean) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new BadRequestException('boolean field must be true or false');
  }

  private optionalNonNegativeInt(value: unknown, field: string, defaultValue: number | null, max: number) {
    if (value === undefined || value === null || value === '') {
      return defaultValue;
    }

    const numericValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isInteger(numericValue) || numericValue < 0 || numericValue > max) {
      throw new BadRequestException(`${field} must be an integer between 0 and ${max}`);
    }

    return numericValue;
  }

  private optionalText(value: unknown, field: string, min: number, max: number) {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
      throw new BadRequestException(`${field} must be a string with ${min}-${max} characters`);
    }

    return value.trim();
  }
}
