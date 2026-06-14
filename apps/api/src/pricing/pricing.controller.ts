import { BadRequestException, Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { PricingService } from './pricing.service';

@Controller('pricing')
@UseGuards(AuthGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('models')
  getModelPricing(@Req() request: AuthenticatedRequest) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.pricingService.getModelPricing(request.auth.user);
  }
}
