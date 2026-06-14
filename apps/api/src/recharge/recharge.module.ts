import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AdminRechargeController, RechargeController } from './recharge.controller';
import { RechargeService } from './recharge.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminRechargeController, RechargeController],
  providers: [RechargeService, AdminGuard, PrismaService]
})
export class RechargeModule {}
