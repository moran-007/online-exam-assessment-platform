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
  sessionId: string;
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

  async issueTokens(
    user: RequestUser,
    context: RequestContext,
    options: { rememberMe?: boolean; sessionId?: string; sessionExpiresAt?: Date } = {},
  ) {
    const sessionId = options.sessionId ?? randomUUID();
    const rememberMe = options.rememberMe ?? true;
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        sessionId,
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

    const refresh = await this.createRefreshToken(
      user.id,
      context,
      sessionId,
      rememberMe,
      options.sessionExpiresAt,
    );

    return {
      accessToken,
      refreshToken: refresh.token,
      session: {
        rememberMe,
        idleTimeoutMs: this.getIdleTimeoutMs(),
        expiresAt: refresh.expiresAt.toISOString(),
      },
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

    await this.assertSessionNotIdle(stored.sessionId, stored.lastActivityAt);

    const user = await this.usersService.findAuthenticatedById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('用户不存在或已禁用');
    }

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revoked.count !== 1) {
      throw new UnauthorizedException('Refresh Token 已被使用');
    }

    return this.issueTokens(user, context, {
      rememberMe: stored.rememberMe,
      sessionId: stored.sessionId,
      sessionExpiresAt: stored.expiresAt,
    });
  }

  async assertActiveSession(sessionId: string, markActive = false) {
    if (!sessionId) {
      throw new UnauthorizedException('登录会话无效');
    }

    const now = new Date();
    const session = await this.prisma.refreshToken.findFirst({
      where: {
        sessionId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!session) {
      throw new UnauthorizedException('登录会话已失效');
    }

    await this.assertSessionNotIdle(sessionId, session.lastActivityAt);

    if (markActive) {
      await this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null, expiresAt: { gt: now } },
        data: { lastActivityAt: now },
      });
    }
  }

  async revokeRefreshToken(refreshToken: string) {
    const payload = await this.verifyRefreshToken(refreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
      select: { sessionId: true },
    });

    if (!stored) return;

    await this.prisma.refreshToken.updateMany({
      where: {
        sessionId: stored.sessionId,
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

  private async createRefreshToken(
    userId: string,
    context: RequestContext,
    sessionId: string,
    rememberMe: boolean,
    sessionExpiresAt?: Date,
  ) {
    const jti = randomUUID();
    const expiresIn = rememberMe
      ? (this.config.get<string>('jwt.rememberExpiresIn') ?? '7d')
      : (this.config.get<string>('jwt.sessionExpiresIn') ?? '8h');
    const expiresAt = sessionExpiresAt ?? this.resolveExpiresAt(expiresIn);
    const remainingSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const refreshToken = await this.jwt.signAsync(
      {
        sub: userId,
        jti,
        type: 'refresh',
      } satisfies RefreshTokenPayload,
      {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: remainingSeconds,
      },
    );

    await this.prisma.refreshToken.create({
      data: {
        userId,
        jti,
        sessionId,
        tokenHash: this.hashToken(refreshToken),
        rememberMe,
        lastActivityAt: new Date(),
        expiresAt,
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });

    return { token: refreshToken, expiresAt };
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
    return new Date(Date.now() + this.resolveDurationMs(expiresIn, 7 * 24 * 60 * 60 * 1000));
  }

  private getIdleTimeoutMs() {
    const expiresIn = this.config.get<string>('jwt.idleExpiresIn') ?? '30m';
    return this.resolveDurationMs(expiresIn, 30 * 60 * 1000);
  }

  private async assertSessionNotIdle(sessionId: string, lastActivityAt: Date) {
    if (Date.now() - lastActivityAt.getTime() <= this.getIdleTimeoutMs()) return;

    await this.prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new UnauthorizedException('登录已因长时间未操作而失效');
  }

  private resolveDurationMs(expiresIn: string, fallbackMs: number) {
    const match = /^(\d+)([smhd])?$/.exec(expiresIn);

    if (!match) {
      return fallbackMs;
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

    return value * multiplier;
  }
}
