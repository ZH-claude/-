import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import {
  AdminPaymentOrderController,
  AdminRechargeController,
  PaymentNotifyController,
  RechargeController
} from './recharge.controller';
import { RechargeService } from './recharge.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminRechargeController, AdminPaymentOrderController, RechargeController, PaymentNotifyController],
  providers: [RechargeService, AdminGuard, PrismaService]
})
export class RechargeModule {}
