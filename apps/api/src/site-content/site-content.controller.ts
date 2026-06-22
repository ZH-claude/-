import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SiteContentService } from './site-content.service';

@Controller('admin/site-content')
@UseGuards(AuthGuard, AdminGuard)
export class AdminSiteContentController {
  constructor(@Inject(SiteContentService) private readonly siteContentService: SiteContentService) {}

  @Get()
  getConfig() {
    return this.siteContentService.getConfig();
  }

  @Post()
  updateConfig(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return this.siteContentService.updateConfig(request.auth.user.id, toRecord(body));
  }
}

@Controller('site-content')
export class SiteContentController {
  constructor(@Inject(SiteContentService) private readonly siteContentService: SiteContentService) {}

  @Get()
  getConfig() {
    return this.siteContentService.getConfig();
  }
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
