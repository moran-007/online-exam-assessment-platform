import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLessonPlanProcessPresetDto } from '../../src/modules/lesson-records/dto/lesson-plan-process-preset.dto';
import { LessonPlanProcessPresetsService } from '../../src/modules/lesson-records/lesson-plan-process-presets.service';

describe('LessonPlanProcessPresetsService', () => {
  const actor = {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'teacher-a',
    realName: '张老师',
    userType: 'TEACHER',
    roles: [],
    permissions: ['lesson-record:read', 'lesson-record:manage'],
  };
  const otherActorId = '10000000-0000-4000-8000-000000000002';
  const personalPreset = {
    id: '20000000-0000-4000-8000-000000000001',
    name: '我的过程',
    code: 'lesson-plan-process-personal',
    type: 'LESSON_PLAN_PROCESS',
    templateContent: JSON.stringify([
      { title: '导入', duration: 5 },
      { title: '探究', duration: 35 },
      { title: '总结', duration: 5 },
    ]),
    configJson: null,
    status: 'active',
    createdBy: actor.id,
    createdAt: new Date('2026-07-23T01:00:00.000Z'),
    updatedAt: new Date('2026-07-23T01:00:00.000Z'),
  };

  it('returns three read-only 45-minute built-ins plus only valid current-user presets', async () => {
    const findMany = jest.fn().mockResolvedValue([
      personalPreset,
      {
        ...personalPreset,
        id: 'corrupt',
        templateContent: JSON.stringify([
          { title: '错误内容', duration: 5, unexpected: true },
        ]),
      },
    ]);
    const service = new LessonPlanProcessPresetsService({
      aiPromptTemplate: { findMany },
    } as never, { log: jest.fn() } as never);

    const result = await service.list(actor);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        type: 'LESSON_PLAN_PROCESS',
        status: 'active',
        createdBy: actor.id,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    expect(result.slice(0, 3).map((item) => item.name)).toEqual([
      '讲练结合45',
      '探究互动45',
      '实验实践45',
    ]);
    expect(result.slice(0, 3).every((item) => (
      item.source === 'SYSTEM' &&
      item.canManage === false &&
      item.stages.reduce((sum, stage) => sum + stage.duration, 0) === 45
    ))).toBe(true);
    expect(result).toHaveLength(4);
    expect(result[3]).toMatchObject({
      id: personalPreset.id,
      source: 'PERSONAL',
      canManage: true,
      createdBy: actor.id,
      stages: [
        { title: '导入', duration: 5 },
        { title: '探究', duration: 35 },
        { title: '总结', duration: 5 },
      ],
    });
  });

  it('persists a strict JSON stage array and audits creation', async () => {
    const create = jest.fn().mockImplementation(({ data }) => ({
      ...personalPreset,
      ...data,
    }));
    const audit = { log: jest.fn() };
    const service = new LessonPlanProcessPresetsService({
      aiPromptTemplate: { create },
    } as never, audit as never);

    await expect(service.create({
      name: '  我的讲练方案  ',
      stages: [
        { title: '  导入  ', duration: 5 },
        { title: '练习', duration: 40 },
      ],
    }, actor)).resolves.toMatchObject({
      name: '我的讲练方案',
      stages: [
        { title: '导入', duration: 5 },
        { title: '练习', duration: 40 },
      ],
      source: 'PERSONAL',
      canManage: true,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        name: '我的讲练方案',
        code: expect.stringMatching(/^lesson-plan-process-[0-9a-f-]{36}$/),
        type: 'LESSON_PLAN_PROCESS',
        templateContent: JSON.stringify([
          { title: '导入', duration: 5 },
          { title: '练习', duration: 40 },
        ]),
        status: 'active',
        createdBy: actor.id,
      },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lesson-plan-process-preset:create',
      userId: actor.id,
      afterData: expect.objectContaining({
        storedContentValid: true,
      }),
    }));
  });

  it('supports partial update and delete with audit trails', async () => {
    const updated = { ...personalPreset, name: '更新名称' };
    const findUnique = jest.fn().mockResolvedValue(personalPreset);
    const update = jest.fn().mockResolvedValue(updated);
    const remove = jest.fn().mockResolvedValue(personalPreset);
    const audit = { log: jest.fn() };
    const service = new LessonPlanProcessPresetsService({
      aiPromptTemplate: { findUnique, update, delete: remove },
    } as never, audit as never);

    await expect(service.update(personalPreset.id, {
      name: '  更新名称  ',
    }, actor)).resolves.toMatchObject({
      name: '更新名称',
      stages: [
        { title: '导入', duration: 5 },
        { title: '探究', duration: 35 },
        { title: '总结', duration: 5 },
      ],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: personalPreset.id },
      data: { name: '更新名称' },
    });

    await expect(service.remove(personalPreset.id, actor)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledWith({ where: { id: personalPreset.id } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lesson-plan-process-preset:update',
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'lesson-plan-process-preset:delete',
    }));
  });

  it('keeps built-ins read-only, rejects empty patches, and isolates other owners', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      ...personalPreset,
      createdBy: otherActorId,
    });
    const service = new LessonPlanProcessPresetsService({
      aiPromptTemplate: { findUnique },
    } as never, { log: jest.fn() } as never);

    await expect(service.update(
      'builtin:lesson-plan-process:explain-practice-45',
      { name: '不能修改' },
      actor,
    )).rejects.toThrow(ForbiddenException);
    expect(findUnique).not.toHaveBeenCalled();

    await expect(service.update(personalPreset.id, {}, actor))
      .rejects.toThrow(BadRequestException);
    await expect(service.remove(personalPreset.id, actor))
      .rejects.toThrow('无权修改或删除他人的教学过程预设');
  });
});

describe('CreateLessonPlanProcessPresetDto', () => {
  it('enforces name, stage-count, title, and duration limits', async () => {
    const dto = plainToInstance(CreateLessonPlanProcessPresetDto, {
      name: 'x'.repeat(81),
      stages: [
        { title: 'y'.repeat(121), duration: 0 },
      ],
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['name', 'stages']),
    );
    const stageErrors = errors.find((error) => error.property === 'stages')
      ?.children?.[0]?.children?.map((error) => error.property);
    expect(stageErrors).toEqual(expect.arrayContaining(['title', 'duration']));
  });

  it('rejects more than 20 stages', async () => {
    const dto = plainToInstance(CreateLessonPlanProcessPresetDto, {
      name: '过长方案',
      stages: Array.from({ length: 21 }, (_, index) => ({
        title: `环节${index + 1}`,
        duration: 1,
      })),
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'stages')).toBe(true);
  });
});
