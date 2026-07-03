import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

type PublicQuestionAssetClaims = {
  scope: 'public-question';
  questionId: string;
  exp: number;
};

@Injectable()
export class AssetTokenService {
  constructor(private readonly config: ConfigService) {}

  issuePublicQuestionToken(questionId: string) {
    const claims: PublicQuestionAssetClaims = {
      scope: 'public-question',
      questionId,
      exp: Math.floor((Date.now() + this.expiresInMs()) / 1000),
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verifyPublicQuestionToken(token: string, questionId: string) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) throw new UnauthorizedException('资源访问令牌无效');
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('资源访问令牌无效');
    }

    let claims: PublicQuestionAssetClaims;
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PublicQuestionAssetClaims;
    } catch {
      throw new UnauthorizedException('资源访问令牌无效');
    }
    if (claims.scope !== 'public-question' || claims.questionId !== questionId || claims.exp <= Date.now() / 1000) {
      throw new UnauthorizedException('资源访问令牌已过期或作用域不匹配');
    }
    return claims;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.config.get<string>('assets.signingSecret') ?? 'change_me_asset_secret')
      .update(payload)
      .digest('base64url');
  }

  private expiresInMs() {
    const value = this.config.get<string>('assets.signedUrlExpiresIn') ?? '5m';
    const match = /^(\d+)([smhd])?$/.exec(value);
    if (!match) return 5 * 60 * 1000;
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return Number(match[1]) * (multipliers[match[2] ?? 's'] ?? 1000);
  }
}
