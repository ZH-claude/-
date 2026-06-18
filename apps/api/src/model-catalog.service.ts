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
            priority: true,
            inputPriceCentsPer1k: true,
            outputPriceCentsPer1k: true,
            modelMultiplier: true,
            supportsStream: true
          },
          orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
        }
      },
      orderBy: { model: 'asc' }
    });

    return models.map((model) => {
      const activeRoute = model.upstreamModels.find(
        (upstreamModel) =>
          upstreamModel.inputPriceCentsPer1k !== null &&
          upstreamModel.outputPriceCentsPer1k !== null &&
          upstreamModel.modelMultiplier !== null
      );

      return {
        model: model.model,
        displayName: model.displayName,
        inputPriceCentsPer1k: activeRoute?.inputPriceCentsPer1k ?? model.inputPriceCentsPer1k,
        outputPriceCentsPer1k: activeRoute?.outputPriceCentsPer1k ?? model.outputPriceCentsPer1k,
        modelMultiplier: activeRoute?.modelMultiplier?.toString() ?? model.modelMultiplier.toString(),
        groupMultiplier: group.multiplier.toString(),
        supportsStream: model.upstreamModels.some((upstreamModel) => upstreamModel.supportsStream)
      };
    });
  }
}
