import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.getBearerToken(request.headers.authorization);

    request.auth = await this.authService.getContextFromToken(token);
    return true;
  }

  private getBearerToken(authorization?: string) {
    if (!authorization) {
      throw new UnauthorizedException('缺少认证会话');
    }

    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('认证会话格式错误');
    }

    return token;
  }
}
