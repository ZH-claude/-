import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { TokensModule } from './tokens/tokens.module';
import { RelayModule } from './relay/relay.module';
import { RechargeModule } from './recharge/recharge.module';

@Module({
  imports: [AuthModule, AdminModule, TokensModule, RelayModule, RechargeModule],
  controllers: [AppController]
})
export class AppModule {}
