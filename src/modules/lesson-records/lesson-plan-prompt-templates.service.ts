import {
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
import { SaveLessonPlanPromptTemplateDto } from './dto/lesson-plan-prompt-template.dto';

const LESSON_PLAN_TEMPLATE_TYPE = 'LESSON_PLAN';
const ACTIVE_STATUS = 'active';

const SYSTEM_TEMPLATES = [
  {
    id: 'builtin:lesson-plan:standard-detailed',
    name: '标准详案',
    maxTokens: 6000,
    templateContent: [
      '生成可直接授课、复用和打印的完整详案。教学过程根据课型合理设置环节，不套用固定数量。',
      '每个环节的教师活动与学生活动必须具体、对应、可执行；每一个动作、问题、任务或预期反馈单独换行。',
      '教师活动应写明情境或材料、提问原句、讲解要点、追问或支架、巡视反馈及环节过渡；学生活动应写明观察、操作、讨论、练习过程以及回答要点或可检查的学习产出。',
      '环节内容应与分钟数匹配，避免只写“教师讲解”“学生思考”等空话。核心问题、评价方式、设计意图和教学资源按实际需要填写，无必要可留空。',
    ].join('\n'),
  },
  {
    id: 'builtin:lesson-plan:inquiry-interactive',
    name: '探究互动',
    maxTokens: 6000,
    templateContent: [
      '采用问题驱动的探究课设计，围绕核心概念形成由浅入深的问题链，并保留学生提出假设、验证、交流和修正的空间。',
      '教师活动与学生活动逐项对应，每一个动作、问题、任务或预期反馈单独换行；写出教师提供的材料、提问原句、追问支架、巡视关注点和归纳方式，也写出学生的观察操作、讨论分工、证据表达、展示互评及可检查产出。',
      '内容与环节分钟数匹配，不以“组织探究”“学生讨论”等笼统短语代替教学细节。核心问题、评价方式、设计意图和教学资源仅在确有需要时填写。',
    ].join('\n'),
  },
  {
    id: 'builtin:lesson-plan:explain-practice',
    name: '讲练结合',
    maxTokens: 6000,
    templateContent: [
      '采用精讲、示范、分层练习和即时纠错相结合的课型。新知讲解要呈现例题或案例、思考路径、关键步骤、易错点和方法归纳；练习要包含基础检查、变式迁移与必要的分层任务。',
      '教师活动与学生活动必须具体对应，每一个动作、问题、任务或预期反馈单独换行；明确教师如何提问、示范、巡视、诊断和反馈，明确学生如何独立作答、说明依据、互评订正并形成可检查产出。',
      '教学步骤数量与分钟数匹配，避免空泛表述。核心问题、评价方式、设计意图和教学资源按需填写，无必要可留空。',
    ].join('\n'),
  },
  {
    id: 'builtin:lesson-plan:experiment-practice',
    name: '实验实践',
    maxTokens: 6000,
    templateContent: [
      '采用实验或实践任务组织教学，明确任务情境、材料器具、操作步骤、安全要求、数据或作品记录方式、异常处理、结论形成及迁移应用。',
      '教师活动与学生活动逐项对应，每一个动作、问题、任务或预期反馈单独换行；教师活动写清示范、关键提醒、巡视观察、追问和纠偏，学生活动写清分工、操作、记录、分析、展示和改进，并给出可检查的实验数据、代码、作品或结论。',
      '步骤详略应与分钟数和风险相匹配，不使用“做实验”“学生实践”等笼统短语。核心问题、评价方式、设计意图和教学资源按实际需要填写。',
    ].join('\n'),
  },
] as const;

@Injectable()
export class LessonPlanPromptTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: RequestUser) {
    const personalTemplates = await this.prisma.aiPromptTemplate.findMany({
      where: {
        type: LESSON_PLAN_TEMPLATE_TYPE,
        status: ACTIVE_STATUS,
        createdBy: actor.id,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    return [
      ...SYSTEM_TEMPLATES.map((template) => ({
        ...template,
        source: 'SYSTEM' as const,
        canManage: false,
        createdBy: null,
        createdAt: null,
        updatedAt: null,
      })),
      ...personalTemplates.map((template) => this.personalView(template)),
    ];
  }

  async create(dto: SaveLessonPlanPromptTemplateDto, actor: RequestUser) {
    const item = await this.prisma.aiPromptTemplate.create({
      data: {
        name: dto.name.trim(),
        code: `lesson-plan-${randomUUID()}`,
        type: LESSON_PLAN_TEMPLATE_TYPE,
        templateContent: dto.templateContent.trim(),
        configJson: this.withMaxTokens(null, dto.maxTokens ?? null),
        status: ACTIVE_STATUS,
        createdBy: actor.id,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan-prompt-template:create',
      module: 'lesson-records',
      targetType: 'ai_prompt_template',
      targetId: item.id,
      afterData: this.auditData(item),
    });
    return this.personalView(item);
  }

  async update(
    id: string,
    dto: SaveLessonPlanPromptTemplateDto,
    actor: RequestUser,
  ) {
    const existing = await this.assertManageable(id, actor);
    const item = await this.prisma.aiPromptTemplate.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        templateContent: dto.templateContent.trim(),
        configJson: this.withMaxTokens(
          existing.configJson,
          dto.maxTokens === undefined
            ? this.readMaxTokens(existing.configJson)
            : dto.maxTokens,
        ),
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan-prompt-template:update',
      module: 'lesson-records',
      targetType: 'ai_prompt_template',
      targetId: item.id,
      beforeData: this.auditData(existing),
      afterData: this.auditData(item),
    });
    return this.personalView(item);
  }

  async remove(id: string, actor: RequestUser) {
    const existing = await this.assertManageable(id, actor);
    await this.prisma.aiPromptTemplate.delete({ where: { id } });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-plan-prompt-template:delete',
      module: 'lesson-records',
      targetType: 'ai_prompt_template',
      targetId: id,
      beforeData: this.auditData(existing),
    });
    return true;
  }

  private async assertManageable(id: string, actor: RequestUser) {
    if (SYSTEM_TEMPLATES.some((template) => template.id === id)) {
      throw new ForbiddenException('系统内置指令模板为只读，请另存为个人模板后修改');
    }
    if (!isUUID(id)) {
      throw new NotFoundException('教案生成指令模板不存在');
    }
    const item = await this.prisma.aiPromptTemplate.findUnique({ where: { id } });
    if (
      !item ||
      item.type !== LESSON_PLAN_TEMPLATE_TYPE ||
      item.status !== ACTIVE_STATUS
    ) {
      throw new NotFoundException('教案生成指令模板不存在');
    }
    if (item.createdBy !== actor.id) {
      throw new ForbiddenException('无权修改或删除他人的教案生成指令模板');
    }
    return item;
  }

  private personalView(item: {
    id: string;
    name: string;
    templateContent: string;
    configJson: unknown;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: item.id,
      name: item.name,
      templateContent: item.templateContent,
      maxTokens: this.readMaxTokens(item.configJson),
      source: 'PERSONAL' as const,
      canManage: true,
      createdBy: item.createdBy,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private auditData(item: {
    id: string;
    name: string;
    templateContent: string;
    configJson: unknown;
    createdBy: string | null;
  }) {
    return {
      id: item.id,
      name: item.name,
      templateContent: item.templateContent,
      maxTokens: this.readMaxTokens(item.configJson),
      createdBy: item.createdBy,
    };
  }

  private readMaxTokens(configJson: unknown) {
    if (!configJson || typeof configJson !== 'object' || Array.isArray(configJson)) {
      return null;
    }
    const value = (configJson as Record<string, unknown>).maxTokens;
    return Number.isInteger(value) &&
      (value as number) >= 512 &&
      (value as number) <= 8192
      ? value as number
      : null;
  }

  private withMaxTokens(
    configJson: unknown,
    maxTokens: number | null,
  ): Prisma.InputJsonObject {
    const existing = configJson &&
      typeof configJson === 'object' &&
      !Array.isArray(configJson)
      ? configJson as Prisma.JsonObject
      : {};
    return { ...existing, maxTokens };
  }
}
