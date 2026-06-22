import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { BILLING_FORMULA, BILLING_ROUNDING } from '../billing/billing.constants';
import { DEFAULT_USD_TO_CNY_RATE } from '../billing/token-pricing';
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
      displayCurrency: 'USD',
      settlementCurrency: 'CNY',
      usdToCnyRate: DEFAULT_USD_TO_CNY_RATE,
      unit: 'usd_per_1m_tokens',
      billingFormula: {
        totalCostCnyUnits: BILLING_FORMULA,
        rounding: BILLING_ROUNDING
      },
      models
    };
  }
}
