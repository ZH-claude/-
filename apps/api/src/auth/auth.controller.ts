import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';

const SESSION_COOKIE_NAME = 'nested_api_relay_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const result = await this.authService.register(this.toRecord(body), this.getIpAddress(request));
    this.setSessionCookie(reply, result.token);
    return { user: result.user };
  }

  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const result = await this.authService.login(this.toRecord(body), this.getIpAddress(request));
    this.setSessionCookie(reply, result.token);
    return { user: result.user };
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.getProfile(this.requireAuth(request).user);
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.authService.logout(this.requireAuth(request), this.getIpAddress(request));
    this.clearSessionCookie(reply);
    return result;
  }

  @UseGuards(AuthGuard)
  @Post('change-password')
  changePassword(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.authService.changePassword(this.requireAuth(request), this.toRecord(body), this.getIpAddress(request));
  }

  @UseGuards(AuthGuard)
  @Post('timezone')
  updateTimezone(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.authService.updateTimezone(this.requireAuth(request), this.toRecord(body), this.getIpAddress(request));
  }

  private toRecord(value: unknown) {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private requireAuth(request: AuthenticatedRequest) {
    if (!request.auth) {
      throw new Error('AuthGuard did not attach auth context');
    }

    return request.auth;
  }

  private getIpAddress(request: AuthenticatedRequest) {
    return request.ip ?? request.socket?.remoteAddress;
  }

  private setSessionCookie(reply: FastifyReply, token: string) {
    reply.header(
      'Set-Cookie',
      [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        `Max-Age=${SESSION_TTL_SECONDS}`,
        'HttpOnly',
        'SameSite=Lax',
        this.isSecureCookie() ? 'Secure' : ''
      ]
        .filter(Boolean)
        .join('; ')
    );
  }

  private clearSessionCookie(reply: FastifyReply) {
    reply.header(
      'Set-Cookie',
      [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'Max-Age=0',
        'HttpOnly',
        'SameSite=Lax',
        this.isSecureCookie() ? 'Secure' : ''
      ]
        .filter(Boolean)
        .join('; ')
    );
  }

  private isSecureCookie() {
    const configured = process.env.SESSION_COOKIE_SECURE;
    if (configured) {
      return configured.toLowerCase() === 'true';
    }

    return process.env.NODE_ENV === 'production';
  }
}
