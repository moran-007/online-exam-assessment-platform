import { AiSummaryReviewStatus, AiSummaryType } from '@prisma/client';
import { ExamSummaryQueryUseCases } from '../../src/modules/ai/exam-summary-query.use-cases';

describe('ExamSummaryQueryUseCases', () => {
  it('returns only published summaries for exams attempted by the current student', async () => {
    const publishedAt = new Date('2026-07-16T00:00:00.000Z');
    const published = {
      id: '00000000-0000-0000-0000-000000000001',
      subjectId: '00000000-0000-0000-0000-000000000002',
      summaryJson: { headline: { text: 'published' } },
      evidenceIndexJson: {},
      publishedAt,
    };
    const prisma = {
      examAttempt: { findMany: jest.fn().mockResolvedValue([{ examId: published.subjectId }]) },
      aiSummary: { findMany: jest.fn().mockResolvedValue([published]) },
    };
    const service = new ExamSummaryQueryUseCases(
      prisma as never,
      { assertExamAccessible: jest.fn() } as never,
      {} as never,
    );
    const user = { id: 'student-1' } as never;

    const rows = await service.publishedFor(user);

    expect(rows).toEqual([expect.objectContaining({ id: published.id, examId: published.subjectId, publishedAt })]);
    expect(prisma.aiSummary.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        type: AiSummaryType.EXAM,
        subjectId: { in: [published.subjectId] },
        reviewStatus: AiSummaryReviewStatus.PUBLISHED,
        publishedAt: { not: null },
      },
    }));
  });
});
