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
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types';
import { AiRechargeService } from './ai-recharge.service';

@Controller('admin/ai-recharge')
@UseGuards(AuthGuard, AdminGuard)
export class AdminAiRechargeController {
  constructor(@Inject(AiRechargeService) private readonly aiRechargeService: AiRechargeService) {}

  @Get('page-config')
  getPageConfig() {
    return this.aiRechargeService.getPageConfig();
  }

  @Post('page-config')
  updatePageConfig(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.aiRechargeService.updatePageConfig(this.requireAdminId(request), toRecord(body));
  }

  @Get('products')
  listProducts() {
    return this.aiRechargeService.listAdminProducts();
  }

  @Post('products')
  createProduct(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.aiRechargeService.createProduct(this.requireAdminId(request), toRecord(body));
  }

  @Post('products/:id/update')
  updateProduct(@Req() request: AuthenticatedRequest, @Param('id') productId: string, @Body() body: unknown) {
    return this.aiRechargeService.updateProduct(this.requireAdminId(request), productId, toRecord(body));
  }

  @Post('products/:id/status')
  updateProductStatus(@Req() request: AuthenticatedRequest, @Param('id') productId: string, @Body() body: unknown) {
    return this.aiRechargeService.updateProductStatus(this.requireAdminId(request), productId, toRecord(body));
  }

  @Post('products/:id/delete')
  deleteProduct(@Req() request: AuthenticatedRequest, @Param('id') productId: string) {
    return this.aiRechargeService.deleteProduct(this.requireAdminId(request), productId);
  }

  @Get('orders')
  listOrders() {
    return this.aiRechargeService.listAdminOrders();
  }

  @Post('orders/:id/status')
  updateOrderStatus(@Req() request: AuthenticatedRequest, @Param('id') orderId: string, @Body() body: unknown) {
    return this.aiRechargeService.updateOrderStatus(this.requireAdminId(request), orderId, toRecord(body));
  }

  private requireAdminId(request: AuthenticatedRequest) {
    if (!request.auth?.user?.id) {
      throw new BadRequestException('Admin context missing');
    }

    return request.auth.user.id;
  }
}

@Controller('ai-recharge')
@UseGuards(AuthGuard)
export class AiRechargeController {
  constructor(@Inject(AiRechargeService) private readonly aiRechargeService: AiRechargeService) {}

  @Get('page-config')
  getPageConfig() {
    return this.aiRechargeService.getPageConfig();
  }

  @Get('products')
  listProducts() {
    return this.aiRechargeService.listPublicProducts();
  }

  @Get('orders')
  listOrders(@Req() request: AuthenticatedRequest) {
    return this.aiRechargeService.listUserOrders(this.requireUser(request));
  }

  @Post('orders')
  createOrder(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.aiRechargeService.createOrder(this.requireUser(request), toRecord(body));
  }

  private requireUser(request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.auth?.user) {
      throw new BadRequestException('Auth context missing');
    }

    return request.auth.user;
  }
}

function toRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
