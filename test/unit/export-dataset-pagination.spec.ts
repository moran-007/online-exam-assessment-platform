import { loadQuestionExportItems } from '../../src/modules/exports/export-dataset.operations';
import { ExportsContext } from '../../src/modules/exports/exports.context';

describe('export dataset pagination', () => {
  it('loads question packages through bounded stable cursor pages', async () => {
    const firstPage = Array.from({ length: 250 }, (_, index) => ({ id: `question-${index + 1}` }));
    const secondPage = [{ id: 'question-251' }];
    const findMany = jest.fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);
    const ctx = { prisma: { question: { findMany } } } as unknown as ExportsContext;

    const questions = await loadQuestionExportItems(ctx, {
      type: 'question_bank',
      format: 'zip',
      courseId: 'course-1',
    });

    expect(questions).toHaveLength(251);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      take: 250,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      where: { courseId: 'course-1', deletedAt: null },
    });
    expect(findMany.mock.calls[1][0]).toMatchObject({
      take: 250,
      skip: 1,
      cursor: { id: 'question-250' },
    });
  });
});
