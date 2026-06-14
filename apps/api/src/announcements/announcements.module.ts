import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, PrismaService]
})
export class AnnouncementsModule {}
