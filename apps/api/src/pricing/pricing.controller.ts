import { BadRequestException, Controller, Get, Headers, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { getRequestedLanguage } from '../i18n/localized-content';
import { PricingService } from './pricing.service';

@Controller('pricing')
@UseGuards(AuthGuard)
export class PricingController {
  constructor(@Inject(PricingService) private readonly pricingService: PricingService) {}

  @Get('models')
  getModelPricing(
    @Req() request: AuthenticatedRequest,
    @Query('language') language: unknown,
    @Headers('accept-language') acceptLanguage: unknown
  ) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.pricingService.getModelPricing(request.auth.user, getRequestedLanguage(language, acceptLanguage));
  }
}
