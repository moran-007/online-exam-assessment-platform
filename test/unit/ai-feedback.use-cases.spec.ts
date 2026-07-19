import { BadRequestException } from '@nestjs/common';
import { AiFeedbackStatus, AiFeedbackVerdict, AiSummaryReviewStatus, AiSummaryType } from '@prisma/client';
import { AiFeedbackUseCases } from '../../src/modules/ai/ai-feedback.use-cases';

describe('AiFeedbackUseCases', () => {
  const user = {
    id: '00000000-0000-0000-0000-000000000001', username: 'student', realName: '学生',
    userType: 'STUDENT', roles: ['student'], permissions: ['ai.feedback.create'],
  };
  const summary = {
    id: '00000000-0000-0000-0000-000000000002',
    type: AiSummaryType.STUDENT,
    reviewStatus: AiSummaryReviewStatus.PUBLISHED,
    evidenceIndexJson: { ref1: { refId: 'ref1' } },
  };

  it('accepts evidence-bound feedback for a published summary', async () => {
    const row = {
      id: 'feedback-1', summaryId: summary.id, verdict: AiFeedbackVerdict.HELPFUL, rating: 5,
      evidenceRef: 'ref1', comment: '有帮助', correctionText: null, status: AiFeedbackStatus.OPEN,
      resolutionNote: null, createdAt: new Date(), resolvedAt: null,
    };
    const prisma = { aiSummaryFeedback: { create: jest.fn().mockResolvedValue(row) } };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const service = new AiFeedbackUseCases(
      prisma as never,
      { requirePublishedForFeedback: jest.fn().mockResolvedValue(summary) } as never,
      audit as never,
    );

    const result = await service.create(summary.id, {
      verdict: 'helpful', rating: 5, evidenceRef: 'ref1', comment: '有帮助',
    }, user);

    expect(result).toMatchObject({ verdict: 'helpful', status: 'open', reporterName: '学生' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai:feedback-create' }));
  });

  it('rejects an evidence reference that is not in the published summary', async () => {
    const service = new AiFeedbackUseCases(
      {} as never,
      { requirePublishedForFeedback: jest.fn().mockResolvedValue(summary) } as never,
      {} as never,
    );

    await expect(service.create(summary.id, {
      verdict: 'partial', rating: 3, evidenceRef: 'missing',
    }, user)).rejects.toBeInstanceOf(BadRequestException);
  });
});
