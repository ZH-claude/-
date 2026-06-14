import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';

const SESSION_COOKIE_NAME = 'nested_api_relay_session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.getSessionToken(request);

    request.auth = await this.authService.getContextFromToken(token);
    return true;
  }

  private getSessionToken(request: AuthenticatedRequest) {
    const bearerToken = this.getBearerToken(request.headers.authorization);
    if (bearerToken) {
      return bearerToken;
    }

    const cookieToken = this.getCookieToken(request.headers.cookie);
    if (cookieToken) {
      return cookieToken;
    }

    throw new UnauthorizedException('缺少认证会话');
  }

  private getBearerToken(authorization?: string) {
    if (!authorization) {
      return null;
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('认证会话格式错误');
    }

    return token;
  }

  private getCookieToken(cookieHeader?: string) {
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
    const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));

    if (!sessionCookie) {
      return null;
    }

    const token = sessionCookie.slice(SESSION_COOKIE_NAME.length + 1);
    if (!token) {
      throw new UnauthorizedException('缺少认证会话');
    }

    try {
      return decodeURIComponent(token);
    } catch {
      throw new UnauthorizedException('认证会话格式无效');
    }
  }
}
