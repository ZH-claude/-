import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ModelCatalogService } from '../model-catalog.service';
import { BillingModule } from '../billing/billing.module';
import { RequestLogsModule } from '../request-logs/request-logs.module';
import { TokensModule } from '../tokens/tokens.module';
import { RelayController } from './relay.controller';
import { RelayPolicyService } from './relay-policy.service';
import { RelayService } from './relay.service';

@Module({
  imports: [BillingModule, TokensModule, RequestLogsModule],
  controllers: [RelayController],
  providers: [RelayService, RelayPolicyService, PrismaService, ModelCatalogService]
})
export class RelayModule {}
