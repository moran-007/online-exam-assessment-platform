import { AiSummaryReviewStatus, AiSummaryType } from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import { ExamSummaryLifecycleUseCases } from '../../src/modules/ai/exam-summary-lifecycle.use-cases';

describe('ExamSummaryLifecycleUseCases', () => {
  const user = {
    id: '00000000-0000-0000-0000-000000000001', username: 'teacher', realName: 'Teacher',
    userType: 'TEACHER', roles: ['teacher'], permissions: [],
  };

  it('records an optimistic human review transition', async () => {
    const current = summary(AiSummaryReviewStatus.DRAFT);
    const approved = { ...current, reviewStatus: AiSummaryReviewStatus.APPROVED, reviewedBy: user.id };
    const deps = dependencies(current, approved, 1);

    const result = await deps.service.review(current.id, user);

    expect(result.reviewStatus).toBe('approved');
    expect(deps.prisma.aiSummary.updateMany).toHaveBeenCalledWith({
      where: { id: current.id, draftVersion: 2, reviewStatus: { in: ['DRAFT', 'IN_REVIEW'] } },
      data: { reviewStatus: 'APPROVED', reviewedBy: user.id },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai:summary-review' }));
  });

  it('refuses publication unless the current version was approved', async () => {
    const current = summary(AiSummaryReviewStatus.DRAFT);
    const deps = dependencies(current, current, 0);

    await expect(deps.service.publish(current.id, user)).rejects.toBeInstanceOf(ConflictException);
    expect(deps.audit.log).not.toHaveBeenCalled();
  });

  it('resets approval when an editable summary changes', async () => {
    const current = summary(AiSummaryReviewStatus.APPROVED);
    const edited = { ...current, reviewStatus: AiSummaryReviewStatus.DRAFT, draftVersion: 3, reviewedBy: null };
    const deps = dependencies(current, edited, 1);

    const result = await deps.service.update(current.id, { content: output('edited') }, user);

    expect(result).toMatchObject({ reviewStatus: 'draft', draftVersion: 3, reviewedBy: null });
    expect(deps.prisma.aiSummary.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: current.id, draftVersion: 2 }),
      data: expect.objectContaining({ reviewStatus: 'DRAFT', reviewedBy: null, publishedAt: null }),
    }));
  });

  it('creates an explicit regeneration variant with lineage and audit', async () => {
    const current = summary(AiSummaryReviewStatus.REVOKED);
    const deps = dependencies(current, current, 1);
    deps.tasks.create.mockResolvedValue({ id: 'new-task', status: 'succeeded' });

    await deps.service.regenerate(current.id, { maxTokens: 1000 }, user);

    expect(deps.tasks.create).toHaveBeenCalledWith(
      { examId: current.subjectId, configId: undefined, maxTokens: 1000 },
      user,
      { generationKey: expect.any(String), sourceSummaryId: current.id },
    );
    expect(deps.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai:summary-regenerate' }));
  });

  function dependencies(current: ReturnType<typeof summary>, after: ReturnType<typeof summary>, count: number) {
    const prisma = {
      aiSummary: {
        updateMany: jest.fn().mockResolvedValue({ count }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const tasks = { create: jest.fn() };
    const access = {
      require: jest.fn().mockResolvedValue(current),
      find: jest.fn().mockResolvedValue(after),
    };
    const service = new ExamSummaryLifecycleUseCases(
      prisma as never,
      { validate: jest.fn().mockImplementation((value) => value) } as never,
      audit as never,
      tasks as never,
      access as never,
    );
    return { service, prisma, audit, tasks, access };
  }

  function summary(reviewStatus: AiSummaryReviewStatus) {
    const capturedAt = '2026-07-16T00:00:00.000Z';
    return {
      id: '00000000-0000-0000-0000-000000000002',
      taskId: '00000000-0000-0000-0000-000000000003',
      type: AiSummaryType.EXAM,
      subjectId: '00000000-0000-0000-0000-000000000004',
      summaryJson: output('original'),
      sourceSnapshotJson: {},
      evidenceIndexJson: {
        'exam:1:score': {
          refId: 'exam:1:score', sourceType: 'exam', sourceId: '1', metric: 'score',
          path: '/score', value: 80, capturedAt,
        },
      },
      reviewStatus,
      draftVersion: 2,
      editedBy: null,
      reviewedBy: reviewStatus === AiSummaryReviewStatus.DRAFT ? null : user.id,
      publishedAt: null as Date | null,
      revokedAt: null as Date | null,
      createdAt: new Date(capturedAt),
      updatedAt: new Date(capturedAt),
    };
  }

  function output(text: string) {
    const claim = { text, evidenceRefs: ['exam:1:score'] };
    return {
      schemaVersion: 'exam-summary-output/v1', headline: claim,
      overview: [], strengths: [], risks: [], actions: [], needsReview: [],
    };
  }
});
