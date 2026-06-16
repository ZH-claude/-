import { BadRequestException, Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { GroupAvailabilityService } from './group-availability.service';

@Controller('group-availability')
@UseGuards(AuthGuard)
export class GroupAvailabilityController {
  constructor(@Inject(GroupAvailabilityService) private readonly groupAvailabilityService: GroupAvailabilityService) {}

  @Get('models')
  getGroupAvailability(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.groupAvailabilityService.getGroupAvailability(request.auth.user, query);
  }
}
