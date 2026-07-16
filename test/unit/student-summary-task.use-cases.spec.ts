import { AiSummaryType } from '@prisma/client';
import { StudentSummaryTaskUseCases } from '../../src/modules/ai/student-summary-task.use-cases';

describe('StudentSummaryTaskUseCases', () => {
  it('preserves the selected scope in the common task definition', async () => {
    const dataset = { type: 'student', datasetVersion: 'student-summary/v1' };
    const builder = { build: jest.fn().mockResolvedValue(dataset) };
    const coordinator = { create: jest.fn().mockResolvedValue({ id: 'task-1' }) };
    const service = new StudentSummaryTaskUseCases(builder as never, coordinator as never);
    const dto = {
      studentId: 'student-1', courseId: 'course-1', examIds: ['exam-1'],
      from: '2026-07-01T00:00:00.000Z', to: '2026-07-16T00:00:00.000Z', maxTokens: 900,
    };
    const user = { id: 'teacher-1' } as never;

    await service.create(dto, user);

    expect(builder.build).toHaveBeenCalledWith(dto, user);
    expect(coordinator.create).toHaveBeenCalledWith(expect.objectContaining({
      type: AiSummaryType.STUDENT,
      subjectId: 'student-1',
      scope: {
        studentId: 'student-1', courseId: 'course-1', examIds: ['exam-1'],
        from: dto.from, to: dto.to,
      },
      dataset,
      templateCode: 'student-summary',
      schemaVersion: 'student-summary-output/v1',
      maxTokens: 900,
    }), user, {});
  });
});
