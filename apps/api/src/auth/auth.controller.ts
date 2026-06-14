import { Body, Controller, Get, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.authService.register(this.toRecord(body), this.getIpAddress(request));
  }

  @Post('login')
  login(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.authService.login(this.toRecord(body), this.getIpAddress(request));
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.getProfile(this.requireAuth(request).user);
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@Req() request: AuthenticatedRequest) {
    return this.authService.logout(this.requireAuth(request));
  }

  @UseGuards(AuthGuard)
  @Post('change-password')
  changePassword(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.authService.changePassword(this.requireAuth(request), this.toRecord(body));
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
}
