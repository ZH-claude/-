import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { GroupAvailabilityController } from './group-availability.controller';
import { GroupAvailabilityService } from './group-availability.service';

@Module({
  imports: [AuthModule],
  controllers: [GroupAvailabilityController],
  providers: [GroupAvailabilityService, PrismaService]
})
export class GroupAvailabilityModule {}
