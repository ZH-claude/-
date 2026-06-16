import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma.service';

type RecordRelayRequestInput = {
  requestId: string;
  userId?: string | null;
  tokenId?: string | null;
  upstreamProviderId?: string | null;
  method: string;
  path: string;
  model?: string | null;
  statusCode?: number | null;
  errorCode?: string | null;
  latencyMs?: number | null;
  upstreamLatencyMs?: number | null;
  upstreamStatusCode?: number | null;
  upstreamStatus?: string | null;
};

@Injectable()
export class RequestLogsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordRelayRequest(input: RecordRelayRequestInput) {
    const data = this.buildData(input);

    await this.prisma.requestLog.upsert({
      where: { requestId: input.requestId },
      create: {
        requestId: input.requestId,
        ...data
      },
      update: data
    });
  }

  async recordRelayRequestIfAbsent(input: RecordRelayRequestInput) {
    try {
      await this.prisma.requestLog.create({
        data: {
          requestId: input.requestId,
          ...this.buildData(input)
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }

      throw error;
    }
  }

  private buildData(input: RecordRelayRequestInput) {
    return {
      userId: input.userId ?? null,
      tokenId: input.tokenId ?? null,
      upstreamProviderId: input.upstreamProviderId ?? null,
      method: input.method,
      path: input.path,
      model: input.model ?? null,
      statusCode: input.statusCode ?? null,
      errorCode: input.errorCode ?? null,
      latencyMs: this.nonNegativeInt(input.latencyMs),
      upstreamLatencyMs: this.nonNegativeInt(input.upstreamLatencyMs),
      upstreamStatusCode: input.upstreamStatusCode ?? null,
      upstreamStatus: input.upstreamStatus ?? null,
      completedAt: new Date()
    };
  }

  private nonNegativeInt(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isInteger(value)) {
      return null;
    }

    return Math.max(0, value);
  }
}
