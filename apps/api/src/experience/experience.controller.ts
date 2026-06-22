import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types';
import { ExperienceService } from './experience.service';

type ExperienceRequest = AuthenticatedRequest & {
  headers: AuthenticatedRequest['headers'] & {
    'x-forwarded-for'?: string | string[];
  };
};

@Controller('experience')
@UseGuards(AuthGuard)
export class ExperienceController {
  constructor(@Inject(ExperienceService) private readonly experienceService: ExperienceService) {}

  @Get('models')
  listModels(@Req() request: ExperienceRequest) {
    return this.experienceService.listModels(this.getUser(request));
  }

  @Post('chat')
  @HttpCode(200)
  chat(@Req() request: ExperienceRequest, @Body() body: unknown) {
    return this.experienceService.chat({
      user: this.getUser(request),
      body,
      clientIp: this.getClientIp(request)
    });
  }

  private getUser(request: ExperienceRequest): AuthenticatedUser {
    if (!request.auth?.user) {
      throw new Error('Authenticated user is missing');
    }

    return request.auth.user;
  }

  private getClientIp(request: ExperienceRequest) {
    const forwardedFor = request.headers['x-forwarded-for'];
    const headerValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const candidate = headerValue?.split(',')[0]?.trim() || request.ip || request.socket?.remoteAddress || null;
    return candidate?.replace(/^\[|\]$/g, '').replace(/^::ffff:/i, '') ?? null;
  }
}
