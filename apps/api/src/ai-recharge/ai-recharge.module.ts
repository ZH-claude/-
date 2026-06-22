import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AdminAiRechargeController, AiRechargeController } from './ai-recharge.controller';
import { AiRechargeService } from './ai-recharge.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminAiRechargeController, AiRechargeController],
  providers: [AiRechargeService, AdminGuard, PrismaService]
})
export class AiRechargeModule {}
