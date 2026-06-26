import { Controller, Get, Headers, Inject, Query } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { getRequestedLanguage } from '../i18n/localized-content';

@Controller('announcements')
export class AnnouncementsController {
  constructor(@Inject(AnnouncementsService) private readonly announcementsService: AnnouncementsService) {}

  @Get()
  listPublished(@Query('language') language: unknown, @Headers('accept-language') acceptLanguage: unknown) {
    return this.announcementsService.listPublished(getRequestedLanguage(language, acceptLanguage));
  }
}
