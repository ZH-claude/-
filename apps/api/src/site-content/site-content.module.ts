import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { AdminSiteContentController, SiteContentController } from './site-content.controller';
import { SiteContentService } from './site-content.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminSiteContentController, SiteContentController],
  providers: [SiteContentService, AdminGuard, PrismaService]
})
export class SiteContentModule {}
