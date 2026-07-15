import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../../modules/auth/token.service';
import { UserIdentityReader } from '../../modules/users/queries/user-identity.reader';
import { RequestUser } from '../interfaces/request-user.interface';

type RequestWithUser = {
  headers: Record<string, string | string[] | undefined>;
  user?: RequestUser;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly identityReader: UserIdentityReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException('未登录');
    }

    try {
      const payload = await this.tokenService.verifyAccessToken(token);
      const activityHeader = request.headers['x-session-activity'];
      const marksActivity = (Array.isArray(activityHeader) ? activityHeader[0] : activityHeader) === '1';
      await this.tokenService.assertActiveSession(payload.sessionId, marksActivity);
      const user = await this.identityReader.findAuthenticatedById(payload.sub);

      if (!user) {
        throw new UnauthorizedException('用户不存在或已禁用');
      }

      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new HttpException({ code: 40003, message: 'Token 过期' }, HttpStatus.UNAUTHORIZED);
      }

      throw new UnauthorizedException('Token 无效');
    }
  }

  private extractToken(authorization?: string | string[]): string | undefined {
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    const [type, token] = value?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
