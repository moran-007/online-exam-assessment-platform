import { AiSummaryReviewStatus, AiSummaryType } from '@prisma/client';
import { AiSummaryQueryUseCases } from '../../src/modules/ai/ai-summary-query.use-cases';

describe('AiSummaryQueryUseCases', () => {
  it('returns published exam and own student summaries for the current student', async () => {
    const publishedAt = new Date('2026-07-16T00:00:00.000Z');
    const published = {
      id: '00000000-0000-0000-0000-000000000001',
      type: AiSummaryType.EXAM,
      subjectId: '00000000-0000-0000-0000-000000000002',
      summaryJson: { headline: { text: 'published' } },
      evidenceIndexJson: {},
      publishedAt,
    };
    const prisma = {
      examAttempt: { findMany: jest.fn().mockResolvedValue([{ examId: published.subjectId }]) },
      aiSummary: { findMany: jest.fn().mockResolvedValue([published]) },
    };
    const service = new AiSummaryQueryUseCases(prisma as never, {} as never);
    const user = {
      id: 'student-1', username: 'student', realName: 'Student', userType: 'STUDENT',
      roles: ['student'], permissions: ['ai.summary.view-own'],
    };

    const rows = await service.publishedFor(user);

    expect(rows).toEqual([expect.objectContaining({
      id: published.id, type: 'exam', subjectId: published.subjectId, publishedAt,
    })]);
    expect(prisma.aiSummary.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        reviewStatus: AiSummaryReviewStatus.PUBLISHED,
        publishedAt: { not: null },
        OR: expect.arrayContaining([
          { type: AiSummaryType.STUDENT, subjectId: user.id },
          { type: AiSummaryType.EXAM, subjectId: { in: [published.subjectId] } },
        ]),
      }),
    }));
  });
});
