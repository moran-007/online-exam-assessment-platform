import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { RequestUser } from '../interfaces/request-user.interface';
import { hasPermission } from '../security/permission-policy';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    if (request.user?.userType === 'SUPER_ADMIN') {
      return true;
    }

    if (!requiredPermissions.every((permission) => hasPermission(request.user, permission))) {
      throw new ForbiddenException('无权限访问');
    }

    return true;
  }
}
