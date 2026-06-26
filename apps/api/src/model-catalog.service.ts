import { Injectable, Inject } from '@nestjs/common';
import { GroupStatus, ModelStatus, UpstreamProviderStatus } from './generated/prisma/client';
import { resolveLocalizedText } from './i18n/localized-content';
import { PrismaService } from './prisma.service';

type AvailableModelForGroup = {
  model: string;
  displayName: string | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  groupMultiplier: string;
  supportsStream: boolean;
};

@Injectable()
export class ModelCatalogService {
  private readonly inFlightGroupModelLists = new Map<string, Promise<AvailableModelForGroup[]>>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listAvailableModelsForGroup(groupId: string, language?: string | null) {
    const cacheKey = `${groupId}:${language ?? ''}`;
    const existing = this.inFlightGroupModelLists.get(cacheKey);
    if (existing) {
      return existing;
    }

    const request = this.listAvailableModelsForGroupUncached(groupId, language).finally(() => {
      this.inFlightGroupModelLists.delete(cacheKey);
    });
    this.inFlightGroupModelLists.set(cacheKey, request);
    return request;
  }

  private async listAvailableModelsForGroupUncached(
    groupId: string,
    language?: string | null
  ): Promise<AvailableModelForGroup[]> {
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
        displayName: resolveLocalizedText(model.translations, language, 'displayName', model.displayName),
        inputPriceCentsPer1k:
          activeRoute?.inputPriceCentsPer1k != null
            ? activeRoute.inputPriceCentsPer1k
            : model.inputPriceCentsPer1k,
        outputPriceCentsPer1k:
          activeRoute?.outputPriceCentsPer1k != null
            ? activeRoute.outputPriceCentsPer1k
            : model.outputPriceCentsPer1k,
        modelMultiplier: activeRoute ? '1.0000' : model.modelMultiplier.toString(),
        groupMultiplier: group.multiplier.toString(),
        supportsStream: model.upstreamModels.some((upstreamModel) => upstreamModel.supportsStream)
      };
    });
  }
}
