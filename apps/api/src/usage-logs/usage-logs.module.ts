import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { UsageLogsController } from './usage-logs.controller';
import { UsageLogsService } from './usage-logs.service';

@Module({
  imports: [AuthModule],
  controllers: [UsageLogsController],
  providers: [UsageLogsService, PrismaService]
})
export class UsageLogsModule {}
