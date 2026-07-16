import { AiSummaryType } from '@prisma/client';
import { AiSummaryAccessService } from '../../src/modules/ai/ai-summary-access.service';

describe('AiSummaryAccessService', () => {
  it.each([
    [AiSummaryType.EXAM, 'assertExamAccessible'],
    [AiSummaryType.STUDENT, 'assertStudentSummaryAccessible'],
  ] as const)('checks %s summaries against their subject scope', async (type, method) => {
    const summary = { id: 'summary-1', type, subjectId: 'subject-1', task: { scopeJson: {} } };
    const dataScope = {
      assertExamAccessible: jest.fn(),
      assertStudentSummaryAccessible: jest.fn(),
    };
    const service = new AiSummaryAccessService(
      { aiSummary: { findUnique: jest.fn().mockResolvedValue(summary) } } as never,
      dataScope as never,
    );

    await expect(service.require(summary.id, { id: 'teacher-1' } as never)).resolves.toBe(summary);

    expect(dataScope[method]).toHaveBeenCalledWith(expect.anything(), summary.subjectId);
  });
});
