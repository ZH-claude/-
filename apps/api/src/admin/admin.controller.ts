import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
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
  constructor(@Inject(AdminService) private readonly adminService: AdminService) {}

  @Get('dashboard-summary')
  getDashboardSummary() {
    return this.adminService.getDashboardSummary();
  }

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

  @Get('audit-logs')
  listAdminAuditLogs(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string
  ) {
    const page = this.parsePositiveInt(pageValue, 1, 1000000);
    const limit = this.parsePositiveInt(limitValue, 20, 100);

    return this.adminService.listAdminAuditLogs({ page, limit });
  }

  @Get('security-audit-logs')
  listSecurityAuditLogs(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string
  ) {
    const page = this.parsePositiveInt(pageValue, 1, 1000000);
    const limit = this.parsePositiveInt(limitValue, 20, 100);

    return this.adminService.listSecurityAuditLogs({ page, limit });
  }

  @Get('request-logs')
  listRequestLogs(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
    @Query('status') status?: string,
    @Query('model') model?: string
  ) {
    const page = this.parsePositiveInt(pageValue, 1, 1000000);
    const limit = this.parsePositiveInt(limitValue, 20, 100);

    return this.adminService.listRequestLogs({ page, limit, status, model });
  }

  @Get('image-tasks')
  listImageTasks(
    @Query('page') pageValue?: string,
    @Query('limit') limitValue?: string,
    @Query('status') status?: string,
    @Query('platform') platform?: string,
    @Query('model') model?: string
  ) {
    const page = this.parsePositiveInt(pageValue, 1, 1000000);
    const limit = this.parsePositiveInt(limitValue, 20, 100);

    return this.adminService.listImageTasks({ page, limit, status, platform, model });
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

  @Get('model-config')
  listModelConfiguration(
    @Query('upstreamModelsPage') upstreamModelsPageValue?: string,
    @Query('upstreamModelsLimit') upstreamModelsLimitValue?: string
  ) {
    const upstreamModelsPage = this.parsePositiveInt(upstreamModelsPageValue, 1, 1000000);
    const upstreamModelsLimit = this.parsePositiveInt(upstreamModelsLimitValue, 100, 100);

    return this.adminService.listModelConfiguration({ upstreamModelsPage, upstreamModelsLimit });
  }

  @Get('groups')
  listUserGroups() {
    return this.adminService.listUserGroups();
  }

  @Post('groups')
  createUserGroup(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.createUserGroup(request.auth.user.id, this.toRecord(body));
  }

  @Post('users/:id/group')
  assignUserGroup(
    @Req() request: AuthenticatedRequest,
    @Param('id') userId: string,
    @Body() body: unknown
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.assignUserGroup(request.auth.user.id, userId, this.toRecord(body));
  }

  @Post('models')
  createModelPrice(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.createModelPrice(request.auth.user.id, this.toRecord(body));
  }

  @Post('models/:id/update')
  updateModelPrice(
    @Req() request: AuthenticatedRequest,
    @Param('id') modelPriceId: string,
    @Body() body: unknown
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.updateModelPrice(request.auth.user.id, modelPriceId, this.toRecord(body));
  }

  @Post('upstream-models')
  createUpstreamModel(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.adminService.createUpstreamModel(request.auth.user.id, this.toRecord(body));
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
