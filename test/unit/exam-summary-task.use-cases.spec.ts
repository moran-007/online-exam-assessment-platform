import { AiSummaryType } from '@prisma/client';
import { ExamSummaryTaskUseCases } from '../../src/modules/ai/exam-summary-task.use-cases';

describe('ExamSummaryTaskUseCases', () => {
  it('builds the exam dataset and delegates common task creation', async () => {
    const dataset = { type: 'exam', datasetVersion: 'exam-summary/v1' };
    const builder = { build: jest.fn().mockResolvedValue(dataset) };
    const coordinator = { create: jest.fn().mockResolvedValue({ id: 'task-1' }) };
    const service = new ExamSummaryTaskUseCases(builder as never, coordinator as never);
    const user = { id: 'user-1' } as never;

    await service.create({ examId: 'exam-1', maxTokens: 800, confirmRetry: true }, user);

    expect(builder.build).toHaveBeenCalledWith('exam-1', user);
    expect(coordinator.create).toHaveBeenCalledWith(expect.objectContaining({
      type: AiSummaryType.EXAM,
      subjectId: 'exam-1',
      scope: { examId: 'exam-1' },
      dataset,
      templateCode: 'exam-summary',
      schemaVersion: 'exam-summary-output/v1',
      maxTokens: 800,
    }), user, { confirmRetry: true });
  });
});
