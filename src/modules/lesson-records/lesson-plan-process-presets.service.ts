import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLessonPlanProcessPresetDto,
  LessonPlanProcessPresetStageDto,
  UpdateLessonPlanProcessPresetDto,
} from './dto/lesson-plan-process-preset.dto';

const TEMPLATE_TYPE = 'LESSON_PLAN_PROCESS';
const ACTIVE_STATUS = 'active';

const SYSTEM_PRESETS = [
  {
    id: 'builtin:lesson-plan-process:explain-practice-45',
    name: '讲练结合45',
    stages: [
      { title: '导入新课', duration: 5 },
      { title: '精讲示范', duration: 15 },
      { title: '分层练习', duration: 15 },
      { title: '讲评纠错', duration: 7 },
      { title: '课堂小结', duration: 3 },
    ],
  },
  {
    id: 'builtin:lesson-plan-process:inquiry-interactive-45',
    name: '探究互动45',
    stages: [
      { title: '情境导入', duration: 5 },
      { title: '提出问题', duration: 5 },
      { title: '自主探究', duration: 12 },
      { title: '合作交流', duration: 10 },
      { title: '展示论证', duration: 8 },
      { title: '归纳评价', duration: 5 },
    ],
  },
  {
    id: 'builtin:lesson-plan-process:experiment-practice-45',
    name: '实验实践45',
    stages: [
      { title: '任务导入', duration: 5 },
      { title: '安全说明与方案设计', duration: 7 },
      { title: '实验操作', duration: 18 },
      { title: '数据分析', duration: 8 },
      { title: '交流评价', duration: 5 },
      { title: '总结整理', duration: 2 },
    ],
  },
] as const;

type StoredPreset = {
  id: string;
  name: string;
  type: string;
  templateContent: string;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class LessonPlanProcessPresetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser) {
    const personalPresets = await this.prisma.aiPromptTemplate.findMany({
      where: {
        type: TEMPLATE_TYPE,
        status: ACTIVE_STATUS,
        createdBy: actor.id,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return [
      ...SYSTEM_PRESETS.map((preset) => this.systemView(preset)),
      ...personalPresets.flatMap((preset) => {
        const stages = this.safeParseStages(preset.templateContent);
        return stages ? [this.personalView(preset, stages)] : [];
      }),
    ];
  }

  async create(dto: CreateLessonPlanProcessPresetDto, actor: RequestUser) {
    const stages = this.normalizeStages(dto.stages);
    const item = await this.prisma.aiPromptTemplate.create({
      data: {
        name: dto.name.trim(),
        code: `lesson-plan-process-${randomUUID()}`,
        type: TEMPLATE_TYPE,
        templateContent: JSON.stringify(stages),
        status: ACTIVE_STATUS,
        createdBy: actor.id,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan-process-preset:create',
      module: 'lesson-records',
      targetType: 'ai_prompt_template',
      targetId: item.id,
      afterData: this.auditData(item, stages),
    });
    return this.personalView(item, stages);
  }

  async update(
    id: string,
    dto: UpdateLessonPlanProcessPresetDto,
    actor: RequestUser,
  ) {
    if (dto.name === undefined && dto.stages === undefined) {
      throw new BadRequestException('请至少修改预设名称或教学环节');
    }
    const existing = await this.assertManageable(id, actor);
    const previousStages = this.safeParseStages(existing.templateContent);
    const nextStages = dto.stages === undefined
      ? previousStages
      : this.normalizeStages(dto.stages);
    if (!nextStages) {
      throw new BadRequestException('已存储的教学过程预设内容无效，请重新提交教学环节');
    }
    const item = await this.prisma.aiPromptTemplate.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.stages === undefined
          ? {}
          : { templateContent: JSON.stringify(nextStages) }),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan-process-preset:update',
      module: 'lesson-records',
      targetType: 'ai_prompt_template',
      targetId: item.id,
      beforeData: this.auditData(existing, previousStages),
      afterData: this.auditData(item, nextStages),
    });
    return this.personalView(item, nextStages);
  }

  async remove(id: string, actor: RequestUser) {
    const existing = await this.assertManageable(id, actor);
    const stages = this.safeParseStages(existing.templateContent);
    await this.prisma.aiPromptTemplate.delete({ where: { id } });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan-process-preset:delete',
      module: 'lesson-records',
      targetType: 'ai_prompt_template',
      targetId: id,
      beforeData: this.auditData(existing, stages),
    });
    return true;
  }

  private async assertManageable(id: string, actor: RequestUser) {
    if (SYSTEM_PRESETS.some((preset) => preset.id === id)) {
      throw new ForbiddenException('系统内置教学过程预设为只读');
    }
    if (!isUUID(id)) {
      throw new NotFoundException('教学过程预设不存在');
    }
    const item = await this.prisma.aiPromptTemplate.findUnique({ where: { id } });
    if (
      !item ||
      item.type !== TEMPLATE_TYPE ||
      item.status !== ACTIVE_STATUS
    ) {
      throw new NotFoundException('教学过程预设不存在');
    }
    if (item.createdBy !== actor.id) {
      throw new ForbiddenException('无权修改或删除他人的教学过程预设');
    }
    return item;
  }

  private systemView(preset: typeof SYSTEM_PRESETS[number]) {
    return {
      id: preset.id,
      name: preset.name,
      stages: preset.stages.map((stage) => ({ ...stage })),
      source: 'SYSTEM' as const,
      canManage: false,
      createdBy: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  private personalView(item: StoredPreset, stages: LessonPlanProcessPresetStageDto[]) {
    return {
      id: item.id,
      name: item.name,
      stages,
      source: 'PERSONAL' as const,
      canManage: true,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private auditData(
    item: Pick<StoredPreset, 'id' | 'name' | 'createdBy'>,
    stages: LessonPlanProcessPresetStageDto[] | null,
  ): Prisma.InputJsonObject {
    const auditStages: Prisma.InputJsonArray | null = stages
      ? stages.map((stage) => ({
          title: stage.title,
          duration: stage.duration,
        }))
      : null;
    return {
      id: item.id,
      name: item.name,
      stages: auditStages,
      storedContentValid: stages !== null,
      createdBy: item.createdBy,
    };
  }

  private normalizeStages(stages: LessonPlanProcessPresetStageDto[]) {
    return stages.map((stage) => ({
      title: stage.title.trim(),
      duration: stage.duration,
    }));
  }

  private safeParseStages(value: unknown): LessonPlanProcessPresetStageDto[] | null {
    if (typeof value !== 'string') return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 20) {
      return null;
    }
    const stages: LessonPlanProcessPresetStageDto[] = [];
    for (const stage of parsed) {
      if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return null;
      const record = stage as Record<string, unknown>;
      const keys = Object.keys(record);
      if (
        keys.length !== 2 ||
        !keys.includes('title') ||
        !keys.includes('duration') ||
        typeof record.title !== 'string'
      ) {
        return null;
      }
      const title = record.title.trim();
      if (
        !title ||
        title.length > 120 ||
        !Number.isInteger(record.duration) ||
        (record.duration as number) < 1 ||
        (record.duration as number) > 300
      ) {
        return null;
      }
      stages.push({ title, duration: record.duration as number });
    }
    return stages;
  }
}
