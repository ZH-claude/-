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
    return this.rechargeService.createRechargeCodes(this.requireUserId(request), toRecord(body));
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
}

@Controller('admin/payment-orders')
@UseGuards(AuthGuard, AdminGuard)
export class AdminPaymentOrderController {
  constructor(@Inject(RechargeService) private readonly rechargeService: RechargeService) {}

  @Get()
  listPaymentOrders() {
    return this.rechargeService.listAdminPaymentOrders();
  }

  @Post(':orderNo/mock-success')
  mockPaymentSuccess(@Req() request: AuthenticatedRequest, @Param('orderNo') orderNo: string) {
    return this.rechargeService.mockConfirmPaymentOrder(this.requireUserId(request), orderNo);
  }

  private requireUserId(request: AuthenticatedRequest) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return request.auth.user.id;
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
    return this.rechargeService.redeemRechargeCode(this.requireUser(request), toRecord(body));
  }

  @Post('payments/orders')
  createPaymentOrder(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.rechargeService.createPaymentOrder(this.requireUser(request), toRecord(body));
  }

  @Get('payments/orders')
  listPaymentOrders(@Req() request: AuthenticatedRequest) {
    return this.rechargeService.listUserPaymentOrders(this.requireUser(request));
  }

  @Get('payments/orders/:orderNo')
  getPaymentOrder(@Req() request: AuthenticatedRequest, @Param('orderNo') orderNo: string) {
    return this.rechargeService.getUserPaymentOrder(this.requireUser(request), orderNo);
  }

  private requireUser(request: AuthenticatedRequest) {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return request.auth.user;
  }
}

@Controller('payment-notify')
export class PaymentNotifyController {
  constructor(@Inject(RechargeService) private readonly rechargeService: RechargeService) {}

  @Post(':channel')
  handleNotify(@Param('channel') channel: string, @Body() body: unknown) {
    return this.rechargeService.handleProviderNotify(channel, toRecord(body));
  }
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
