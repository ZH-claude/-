import { Injectable, Inject } from '@nestjs/common';
import { GroupStatus, ModelStatus, UpstreamProviderStatus } from './generated/prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class ModelCatalogService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listAvailableModelsForGroup(groupId: string) {
    const group = await this.prisma.userGroup.findUnique({
      where: { id: groupId }
    });

    if (!group || group.status !== GroupStatus.ACTIVE) {
      return [];
    }

    const models = await this.prisma.modelPrice.findMany({
      where: {
        status: ModelStatus.ACTIVE,
        groupAccesses: {
          some: { groupId }
        },
        upstreamModels: {
          some: {
            status: ModelStatus.ACTIVE,
            provider: {
              status: UpstreamProviderStatus.ACTIVE
            }
          }
        }
      },
      include: {
        upstreamModels: {
          where: {
            status: ModelStatus.ACTIVE,
            provider: {
              status: UpstreamProviderStatus.ACTIVE
            }
          },
          select: {
            supportsStream: true
          }
        }
      },
      orderBy: { model: 'asc' }
    });

    return models.map((model) => ({
      model: model.model,
      displayName: model.displayName,
      inputPriceCentsPer1k: model.inputPriceCentsPer1k,
      outputPriceCentsPer1k: model.outputPriceCentsPer1k,
      modelMultiplier: model.modelMultiplier.toString(),
      groupMultiplier: group.multiplier.toString(),
      supportsStream: model.upstreamModels.some((upstreamModel) => upstreamModel.supportsStream)
    }));
  }
}
