import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { TokensModule } from './tokens/tokens.module';
import { RelayModule } from './relay/relay.module';
import { RechargeModule } from './recharge/recharge.module';
import { UsageLogsModule } from './usage-logs/usage-logs.module';
import { PricingModule } from './pricing/pricing.module';
import { GroupAvailabilityModule } from './group-availability/group-availability.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    AuthModule,
    AdminModule,
    TokensModule,
    RelayModule,
    RechargeModule,
    UsageLogsModule,
    PricingModule,
    GroupAvailabilityModule,
    NotificationsModule
  ],
  controllers: [AppController]
})
export class AppModule {}
