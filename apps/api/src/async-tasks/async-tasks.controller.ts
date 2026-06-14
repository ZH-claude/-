import { BadRequestException, Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { AsyncTasksService } from './async-tasks.service';

@Controller('async-tasks')
@UseGuards(AuthGuard)
export class AsyncTasksController {
  constructor(private readonly asyncTasksService: AsyncTasksService) {}

  @Get()
  listTasks(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return this.asyncTasksService.listTasks(request.auth.user, query);
  }
}
