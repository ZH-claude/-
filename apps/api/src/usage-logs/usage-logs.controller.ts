import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { UsageLogsService } from './usage-logs.service';

@Controller('usage')
@UseGuards(AuthGuard)
export class UsageLogsController {
  constructor(private readonly usageLogsService: UsageLogsService) {}

  @Get('logs')
  listUsageLogs(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.usageLogsService.listUsageLogs(request.auth.user, query);
  }
}
