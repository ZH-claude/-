import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { RequestLogsService } from './request-logs.service';

@Module({
  providers: [RequestLogsService, PrismaService],
  exports: [RequestLogsService]
})
export class RequestLogsModule {}
