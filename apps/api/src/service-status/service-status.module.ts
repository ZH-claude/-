import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ServiceStatusController } from './service-status.controller';
import { ServiceStatusService } from './service-status.service';

@Module({
  controllers: [ServiceStatusController],
  providers: [ServiceStatusService, PrismaService]
})
export class ServiceStatusModule {}
