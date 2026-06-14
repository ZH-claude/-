import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string
  ) {
    const page = this.parsePositiveInt(pageValue, 1, 1000000);
    const limit = this.parsePositiveInt(limitValue, 20, 100);

    return this.adminService.listUsers({ page, limit });
  }

  @Post('announcements')
  createAnnouncement(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.createAnnouncement(request.auth.user.id, this.toRecord(body));
  }

  @Get('announcements')
  listAnnouncements() {
    return this.adminService.listAnnouncements();
  }

  @Get('upstreams')
  listUpstreamProviders() {
    return this.adminService.listUpstreamProviders();
  }

  @Post('upstreams')
  createUpstreamProvider(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.createUpstreamProvider(request.auth.user.id, this.toRecord(body));
  }

  @Post('upstreams/:id/health-check')
  checkUpstreamHealth(
    @Req() request: AuthenticatedRequest,
    @Param('id') upstreamProviderId: string
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.checkUpstreamHealth(request.auth.user.id, upstreamProviderId);
  }

  private parsePositiveInt(value: string | undefined, defaultValue: number, max: number) {
    if (!value) {
      return defaultValue;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
      throw new BadRequestException('Invalid pagination value');
    }

    return parsed;
  }

  private toRecord(value: unknown) {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }
}
