import { BadRequestException, Body, Controller, Get, Inject, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notificationsService: NotificationsService) {}

  @Get('settings')
  getSettings(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.getSettings(this.requireUser(request));
  }

  @Put('settings')
  updateSettings(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.notificationsService.updateSettings(this.requireUser(request), this.toRecord(body));
  }

  @Post('test-webhook')
  testWebhook(@Req() request: AuthenticatedRequest) {
    return this.notificationsService.testWebhook(this.requireUser(request));
  }

  private requireUser(request: AuthenticatedRequest) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return request.auth.user;
  }

  private toRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
}
