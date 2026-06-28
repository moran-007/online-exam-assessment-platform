import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../common/interfaces/request-context.interface';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  userType: string;
  roles: string[];
  permissions: string[];
  type: 'access';
}

interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async issueTokens(user: RequestUser, context: RequestContext) {
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        username: user.username,
        userType: user.userType,
        roles: user.roles,
        permissions: user.permissions,
        type: 'access',
      } satisfies AccessTokenPayload,
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessExpiresIn') as never,
      },
    );

    const refreshToken = await this.createRefreshToken(user.id, context);

    return {
      accessToken,
      refreshToken,
    };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.config.get<string>('jwt.accessSecret'),
    });

    if (payload.type !== 'access') {
      throw new UnauthorizedException('Token 类型错误');
    }

    return payload;
  }

  async rotateRefreshToken(refreshToken: string, context: RequestContext) {
    const payload = await this.verifyRefreshToken(refreshToken);
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });

    if (
      !stored ||
      stored.tokenHash !== tokenHash ||
      stored.revokedAt ||
      stored.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException('Refresh Token 无效');
    }

    const user = await this.usersService.findAuthenticatedById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('用户不存在或已禁用');
    }

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user, context);
  }

  async revokeRefreshToken(refreshToken: string) {
    const payload = await this.verifyRefreshToken(refreshToken);

    await this.prisma.refreshToken.updateMany({
      where: {
        jti: payload.jti,
        tokenHash: this.hashToken(refreshToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private async createRefreshToken(userId: string, context: RequestContext) {
    const jti = randomUUID();
    const expiresIn = this.config.get<string>('jwt.refreshExpiresIn') ?? '7d';
    const refreshToken = await this.jwt.signAsync(
      {
        sub: userId,
        jti,
        type: 'refresh',
      } satisfies RefreshTokenPayload,
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: expiresIn as never,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        jti,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.resolveExpiresAt(expiresIn),
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });

    return refreshToken;
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.get<string>('jwt.refreshSecret'),
    });

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Refresh Token 类型错误');
    }

    return payload;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private resolveExpiresAt(expiresIn: string) {
    const match = /^(\d+)([smhd])?$/.exec(expiresIn);

    if (!match) {
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }

    const value = Number(match[1]);
    const unit = match[2] ?? 's';
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    const multiplier = multipliers[unit] ?? multipliers.s;

    return new Date(Date.now() + value * multiplier);
  }
}
