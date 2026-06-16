import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ModelCatalogService } from '../model-catalog.service';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [SecurityAuditModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PrismaService, ModelCatalogService],
  exports: [AuthService, AuthGuard, ModelCatalogService]
})
export class AuthModule {}
