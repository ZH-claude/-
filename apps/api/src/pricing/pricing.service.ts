import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { BILLING_FORMULA, BILLING_ROUNDING } from '../billing/billing.constants';
import { ModelCatalogService } from '../model-catalog.service';

@Injectable()
export class PricingService {
  constructor(@Inject(ModelCatalogService) private readonly modelCatalogService: ModelCatalogService) {}

  async getModelPricing(user: AuthenticatedUser) {
    const models = await this.modelCatalogService.listAvailableModelsForGroup(user.group.id);

    return {
      group: {
        code: user.group.code,
        name: user.group.name,
        multiplier: user.group.multiplier.toString()
      },
      currency: 'USD',
      unit: 'cents_per_1k_tokens',
      billingFormula: {
        totalCostCents: BILLING_FORMULA,
        rounding: BILLING_ROUNDING
      },
      models
    };
  }
}
