import { BadRequestException, Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/interfaces/request-context.interface';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { LoginDto } from './dto/login.dto';
import { AuthProvider } from './providers/auth-provider.interface';
import { PasswordAuthProvider } from './providers/password-auth.provider';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  private readonly providers: Map<string, AuthProvider>;

  constructor(
    passwordAuthProvider: PasswordAuthProvider,
    private readonly tokenService: TokenService,
    private readonly auditService: AuditService,
  ) {
    this.providers = new Map([[passwordAuthProvider.provider, passwordAuthProvider]]);
  }

  async login(dto: LoginDto, context: RequestContext) {
    const provider = this.providers.get(dto.provider ?? 'password');

    if (!provider) {
      throw new BadRequestException('不支持的登录方式');
    }

    const user = await provider.validate(dto, context);
    const tokens = await this.tokenService.issueTokens(user, context);

    await this.auditService.log({
      userId: user.id,
      action: 'login',
      module: 'auth',
      targetType: 'user',
      targetId: user.id,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return {
      ...tokens,
      user,
    };
  }

  async refresh(refreshToken: string, context: RequestContext) {
    return this.tokenService.rotateRefreshToken(refreshToken, context);
  }

  me(user: RequestUser) {
    return user;
  }

  async logout(user: RequestUser, context: RequestContext, refreshToken?: string) {
    if (refreshToken) {
      await this.tokenService.revokeRefreshToken(refreshToken);
    } else {
      await this.tokenService.revokeAllForUser(user.id);
    }

    await this.auditService.log({
      userId: user.id,
      action: 'logout',
      module: 'auth',
      targetType: 'user',
      targetId: user.id,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return true;
  }
}
