import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ModelCatalogService } from '../model-catalog.service';
import { TokensModule } from '../tokens/tokens.module';
import { RelayController } from './relay.controller';
import { RelayService } from './relay.service';

@Module({
  imports: [TokensModule],
  controllers: [RelayController],
  providers: [RelayService, PrismaService, ModelCatalogService]
})
export class RelayModule {}
