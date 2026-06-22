import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ModelCatalogService } from '../model-catalog.service';
import { PrismaService } from '../prisma.service';
import { RelayModule } from '../relay/relay.module';
import { TokensModule } from '../tokens/tokens.module';
import { ExperienceController } from './experience.controller';
import { ExperienceService } from './experience.service';

@Module({
  imports: [AuthModule, RelayModule, TokensModule],
  controllers: [ExperienceController],
  providers: [ExperienceService, PrismaService, ModelCatalogService]
})
export class ExperienceModule {}
