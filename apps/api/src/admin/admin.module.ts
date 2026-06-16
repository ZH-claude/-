import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { SecurityAuditModule } from '../security-audit/security-audit.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [AuthModule, SecurityAuditModule],
  controllers: [AdminController],
  providers: [AdminService, AdminGuard, PrismaService]
})
export class AdminModule {}
