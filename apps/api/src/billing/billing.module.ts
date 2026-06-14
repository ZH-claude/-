import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingService } from './billing.service';

@Module({
  imports: [NotificationsModule],
  providers: [BillingService, PrismaService],
  exports: [BillingService]
})
export class BillingModule {}
