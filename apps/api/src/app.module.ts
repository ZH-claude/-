import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { TokensModule } from './tokens/tokens.module';
import { RelayModule } from './relay/relay.module';

@Module({
  imports: [AuthModule, AdminModule, TokensModule, RelayModule],
  controllers: [AppController]
})
export class AppModule {}
