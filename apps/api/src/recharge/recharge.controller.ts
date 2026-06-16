import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards
} from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedRequest } from '../auth/auth.types';
import { RechargeService } from './recharge.service';

@Controller('admin/recharge-codes')
@UseGuards(AuthGuard, AdminGuard)
export class AdminRechargeController {
  constructor(@Inject(RechargeService) private readonly rechargeService: RechargeService) {}

  @Get()
  listRechargeCodes() {
    return this.rechargeService.listAdminRechargeCodes();
  }

  @Post()
  createRechargeCodes(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.rechargeService.createRechargeCodes(this.requireUserId(request), this.toRecord(body));
  }

  @Post(':id/disable')
  disableRechargeCode(@Req() request: AuthenticatedRequest, @Param('id') codeId: string) {
    return this.rechargeService.disableRechargeCode(this.requireUserId(request), codeId);
  }

  private requireUserId(request: AuthenticatedRequest) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return request.auth.user.id;
  }

  private toRecord(value: unknown) {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }
}

@Controller('recharge')
@UseGuards(AuthGuard)
export class RechargeController {
  constructor(@Inject(RechargeService) private readonly rechargeService: RechargeService) {}

  @Get('records')
  listRechargeRecords(@Req() request: AuthenticatedRequest) {
    return this.rechargeService.listUserRechargeRecords(this.requireUser(request));
  }

  @Post('redeem')
  redeemRechargeCode(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.rechargeService.redeemRechargeCode(this.requireUser(request), this.toRecord(body));
  }

  private requireUser(request: AuthenticatedRequest) {
    if (!request.auth?.user) {
      throw new BadRequestException('认证上下文缺失');
    }

    return request.auth.user;
  }

  private toRecord(value: unknown) {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }
}
