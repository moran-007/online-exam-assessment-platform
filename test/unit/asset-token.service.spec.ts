import { ConfigService } from '@nestjs/config';
import { AssetTokenService } from '../../src/modules/uploads/asset-token.service';

describe('AssetTokenService', () => {
  const service = new AssetTokenService(new ConfigService({
    assets: { signingSecret: 'unit_test_asset_secret_longer_than_32_chars', signedUrlExpiresIn: '5m' },
  }));

  it('accepts a valid scoped token and rejects cross-scope or tampered tokens', () => {
    const token = service.issuePublicQuestionToken('question-a');
    expect(service.verifyPublicQuestionToken(token, 'question-a').questionId).toBe('question-a');
    expect(() => service.verifyPublicQuestionToken(token, 'question-b')).toThrow('作用域不匹配');
    expect(() => service.verifyPublicQuestionToken(`${token}x`, 'question-a')).toThrow('资源访问令牌无效');
  });

  it('rejects expired tokens', () => {
    const expiring = new AssetTokenService(new ConfigService({
      assets: { signingSecret: 'unit_test_asset_secret_longer_than_32_chars', signedUrlExpiresIn: '1s' },
    }));
    jest.useFakeTimers().setSystemTime(new Date('2026-07-03T00:00:00Z'));
    const token = expiring.issuePublicQuestionToken('question-a');
    jest.setSystemTime(new Date('2026-07-03T00:00:02Z'));
    expect(() => expiring.verifyPublicQuestionToken(token, 'question-a')).toThrow('已过期');
    jest.useRealTimers();
  });
});
