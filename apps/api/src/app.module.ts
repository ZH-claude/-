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
import { AnnouncementsModule } from './announcements/announcements.module';
import { AsyncTasksModule } from './async-tasks/async-tasks.module';
import { ExperienceModule } from './experience/experience.module';
import { AiRechargeModule } from './ai-recharge/ai-recharge.module';
import { SiteContentModule } from './site-content/site-content.module';

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
    NotificationsModule,
    AnnouncementsModule,
    AsyncTasksModule,
    ExperienceModule,
    AiRechargeModule,
    SiteContentModule
  ],
  controllers: [AppController]
})
export class AppModule {}
