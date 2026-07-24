import { AiSummaryType } from '@prisma/client';
import { AiSummaryPresetUseCases } from '../../src/modules/ai/ai-summary-preset.use-cases';

describe('AiSummaryPresetUseCases', () => {
  const base = {
    id: 'preset-1', code: 'exam-summary', summaryType: AiSummaryType.EXAM, version: 2,
    systemPrompt: '旧提示词', outputSchema: { type: 'object' }, enabled: true,
    reviewedBy: 'reviewer-1', changeReason: '旧版本', createdBy: 'creator-1',
    createdAt: new Date('2026-07-01'), updatedAt: new Date('2026-07-01'),
  };
  const user = { id: 'admin-1' } as never;

  it('creates a new immutable version and activates it', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockImplementation(({ data }) => ({
      ...base, ...data, id: 'preset-2', createdAt: new Date(), updatedAt: new Date(),
    }));
    const tx = {
      aiSummaryPromptTemplate: {
        findFirst: jest.fn().mockResolvedValue({ version: 2 }),
        updateMany,
        create,
      },
    };
    const audit = { log: jest.fn() };
    const service = new AiSummaryPresetUseCases({
      aiSummaryPromptTemplate: { findUnique: jest.fn().mockResolvedValue(base) },
      $transaction: jest.fn((operation) => operation(tx)),
    } as never, audit as never);

    await expect(service.revise(base.id, {
      systemPrompt: '  新提示词  ', changeReason: '  改善行动建议  ', activate: true,
    }, user)).resolves.toMatchObject({ id: 'preset-2', version: 3, systemPrompt: '新提示词', enabled: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: { code: base.code, enabled: true }, data: { enabled: false },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        version: 3, outputSchema: base.outputSchema, reviewedBy: 'admin-1', createdBy: 'admin-1',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai:summary-preset-revise' }));
  });

  it('can reactivate a historical version while disabling its active peer', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const update = jest.fn().mockResolvedValue({ ...base, enabled: true, reviewedBy: 'admin-1' });
    const tx = { aiSummaryPromptTemplate: { updateMany, update } };
    const audit = { log: jest.fn() };
    const service = new AiSummaryPresetUseCases({
      aiSummaryPromptTemplate: { findUnique: jest.fn().mockResolvedValue({ ...base, enabled: false }) },
      $transaction: jest.fn((operation) => operation(tx)),
    } as never, audit as never);

    await expect(service.activate(base.id, user)).resolves.toMatchObject({ enabled: true, reviewedBy: 'admin-1' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { code: base.code, enabled: true, id: { not: base.id } }, data: { enabled: false },
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: base.id }, data: { enabled: true, reviewedBy: 'admin-1' },
    }));
  });
});
