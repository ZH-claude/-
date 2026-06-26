import { BadRequestException, Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { UsageLogsService } from './usage-logs.service';

@Controller('usage')
@UseGuards(AuthGuard)
export class UsageLogsController {
  constructor(@Inject(UsageLogsService) private readonly usageLogsService: UsageLogsService) {}

  @Get('logs')
  listUsageLogs(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.usageLogsService.listUsageLogs(request.auth.user, query);
  }

  @Get('token-leaderboard')
  listTokenLeaderboard(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.usageLogsService.listTokenLeaderboard(request.auth.user, query);
  }

  @Get('logs/:requestId/trace')
  getUsageTrace(@Req() request: AuthenticatedRequest, @Param('requestId') requestId: string) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.usageLogsService.getUsageTrace(request.auth.user, requestId);
  }
}
