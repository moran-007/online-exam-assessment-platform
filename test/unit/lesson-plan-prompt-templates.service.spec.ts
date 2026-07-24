import { ForbiddenException } from '@nestjs/common';
import { LessonPlanPromptTemplatesService } from '../../src/modules/lesson-records/lesson-plan-prompt-templates.service';

describe('LessonPlanPromptTemplatesService', () => {
  const actor = {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'teacher-a',
    realName: '张老师',
    userType: 'TEACHER',
    roles: [],
    permissions: ['lesson-record:read', 'lesson-record:manage'],
  };
  const otherActorId = '10000000-0000-4000-8000-000000000002';
  const personalTemplate = {
    id: '20000000-0000-4000-8000-000000000001',
    name: '我的模板',
    code: 'lesson-plan-personal',
    type: 'LESSON_PLAN',
    templateContent: '逐步写清教学活动',
    configJson: { maxTokens: 4096, preserved: true },
    status: 'active',
    createdBy: actor.id,
    createdAt: new Date('2026-07-23T01:00:00.000Z'),
    updatedAt: new Date('2026-07-23T01:00:00.000Z'),
  };

  it('returns four read-only detailed built-ins plus only the current teacher templates', async () => {
    const findMany = jest.fn().mockResolvedValue([personalTemplate]);
    const service = new LessonPlanPromptTemplatesService({
      aiPromptTemplate: { findMany },
    } as never, { log: jest.fn() } as never);

    const result = await service.list(actor);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: 'LESSON_PLAN',
        status: 'active',
        createdBy: actor.id,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    expect(result.slice(0, 4).map((item) => item.name)).toEqual([
      '标准详案',
      '探究互动',
      '讲练结合',
      '实验实践',
    ]);
    expect(result.slice(0, 4).every((item) => (
      item.source === 'SYSTEM' &&
      item.canManage === false &&
      item.maxTokens === 6000 &&
      item.templateContent.includes('单独换行')
    ))).toBe(true);
    expect(result[4]).toMatchObject({
      id: personalTemplate.id,
      source: 'PERSONAL',
      canManage: true,
      maxTokens: 4096,
      createdBy: actor.id,
    });
  });

  it('persists a trimmed personal template and writes an audit record', async () => {
    const create = jest.fn().mockImplementation(({ data }) => ({
      ...personalTemplate,
      ...data,
    }));
    const audit = { log: jest.fn() };
    const service = new LessonPlanPromptTemplatesService({
      aiPromptTemplate: { create },
    } as never, audit as never);

    await expect(service.create({
      name: '  课堂互动详案  ',
      templateContent: '  每一步给出可检查产出  ',
      maxTokens: 6000,
    }, actor)).resolves.toMatchObject({
      name: '课堂互动详案',
      templateContent: '每一步给出可检查产出',
      maxTokens: 6000,
      source: 'PERSONAL',
      canManage: true,
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '课堂互动详案',
        code: expect.stringMatching(/^lesson-plan-[0-9a-f-]{36}$/),
        type: 'LESSON_PLAN',
        templateContent: '每一步给出可检查产出',
        configJson: { maxTokens: 6000 },
        status: 'active',
        createdBy: actor.id,
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lesson-plan-prompt-template:create',
      userId: actor.id,
    }));
  });

  it('keeps built-ins read-only and rejects managing another teacher template', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...personalTemplate,
      createdBy: otherActorId,
    });
    const service = new LessonPlanPromptTemplatesService({
      aiPromptTemplate: { findUnique },
    } as never, { log: jest.fn() } as never);
    const dto = { name: '修改', templateContent: '新的生成要求' };

    await expect(service.update(
      'builtin:lesson-plan:standard-detailed',
      dto,
      actor,
    )).rejects.toThrow(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();

    await expect(service.update(personalTemplate.id, dto, actor))
      .rejects.toThrow('无权修改或删除他人的教案生成指令模板');
  });

  it('updates and deletes the current teacher template with audit trails', async () => {
    const updated = {
      ...personalTemplate,
      name: '更新模板',
      templateContent: '更新后的详细要求',
      configJson: { maxTokens: 7000, preserved: true },
    };
    const findUnique = jest.fn().mockResolvedValue(personalTemplate);
    const update = jest.fn().mockResolvedValue(updated);
    const remove = jest.fn().mockResolvedValue(personalTemplate);
    const audit = { log: jest.fn() };
    const service = new LessonPlanPromptTemplatesService({
      aiPromptTemplate: { findUnique, update, delete: remove },
    } as never, audit as never);

    await expect(service.update(personalTemplate.id, {
      name: '  更新模板  ',
      templateContent: '  更新后的详细要求  ',
      maxTokens: 7000,
    }, actor)).resolves.toMatchObject({
      name: '更新模板',
      maxTokens: 7000,
      source: 'PERSONAL',
      canManage: true,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: personalTemplate.id },
      data: {
        name: '更新模板',
        templateContent: '更新后的详细要求',
        configJson: { maxTokens: 7000, preserved: true },
      },
    });

    await expect(service.remove(personalTemplate.id, actor)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({ where: { id: personalTemplate.id } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lesson-plan-prompt-template:update',
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lesson-plan-prompt-template:delete',
    }));
  });

  it('treats missing or invalid stored maxTokens as automatic', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { ...personalTemplate, id: 'bad-1', configJson: { maxTokens: 100 } },
      { ...personalTemplate, id: 'bad-2', configJson: { maxTokens: '6000' } },
      { ...personalTemplate, id: 'old-1', configJson: null },
    ]);
    const service = new LessonPlanPromptTemplatesService({
      aiPromptTemplate: { findMany },
    } as never, { log: jest.fn() } as never);

    const result = await service.list(actor);

    expect(result.slice(4).map((item) => item.maxTokens)).toEqual([
      null,
      null,
      null,
    ]);
  });
});
