import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BillingService } from './billing.service';

@Module({
  providers: [BillingService, PrismaService],
  exports: [BillingService]
})
export class BillingModule {}
