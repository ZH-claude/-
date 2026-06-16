import { Controller, Get, Inject } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';

@Controller('announcements')
export class AnnouncementsController {
  constructor(@Inject(AnnouncementsService) private readonly announcementsService: AnnouncementsService) {}

  @Get()
  listPublished() {
    return this.announcementsService.listPublished();
  }
}
