import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SecurityAuditService } from './security-audit.service';

@Module({
  providers: [SecurityAuditService, PrismaService],
  exports: [SecurityAuditService]
})
export class SecurityAuditModule {}
