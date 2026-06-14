import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '../generated/prisma/client';
import { AuthenticatedRequest } from '../auth/auth.types';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.auth || request.auth.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('需要管理员权限');
    }

    return true;
  }
}
