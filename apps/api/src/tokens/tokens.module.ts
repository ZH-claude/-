import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({
  imports: [AuthModule, SecurityAuditModule],
  controllers: [TokensController],
  providers: [TokensService, PrismaService],
  exports: [TokensService]
})
export class TokensModule {}
