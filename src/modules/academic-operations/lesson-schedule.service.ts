import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseUnitStatus, LessonSessionKind, LessonSessionStatus, Prisma, ScheduleRuleStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { addUtcDays, formatDateOnly, parseDateOnly, zonedDateTime } from './academic-time';
import {
  CancelSessionDto,
  CreateSessionDto,
  GenerateSessionsDto,
  MakeupSessionDto,
  QueryScheduleRuleDto,
  QuerySessionDto,
  RescheduleSessionDto,
  SaveScheduleRuleDto,
} from './dto/schedule.dto';

const sessionInclude = {
  classGroup: { select: { name: true } },
  teacher: { select: { realName: true, username: true } },
  lessonType: { select: { name: true, countInStatistics: true } },
  unitTemplate: { select: { name: true } },
  _count: { select: { attendance: true } },
} as const;

type ReferenceValidationOptions = {
  retainInactiveLessonTypeId?: string;
  retainUnavailableUnitTemplateId?: string;
};

@Injectable()
export class LessonScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async listRules(query: QueryScheduleRuleDto, actor: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const classIds = await this.dataScope.academicClassIdsFor(actor);
    if (query.classId && classIds !== null && !classIds.includes(query.classId)) {
      throw new BadRequestException('班级不在当前数据范围内');
    }
    const where: Prisma.ClassScheduleRuleWhereInput = {
      classId: query.classId ?? (classIds === null ? undefined : { in: classIds }),
      status: query.status,
    };
    const include = {
      classGroup: { select: { name: true } },
      teacher: { select: { realName: true, username: true } },
      lessonType: { select: { name: true } },
      unitTemplate: { select: { name: true } },
    } as const;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.classScheduleRule.findMany({ where, include, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }], skip, take }),
      this.prisma.classScheduleRule.count({ where }),
    ]);
    return { items: items.map(this.ruleView), page, pageSize, total };
  }

  async createRule(dto: SaveScheduleRuleDto, actor: RequestUser) {
    await this.validateRule(dto, actor);
    const item = await this.prisma.classScheduleRule.create({ data: this.ruleData(dto, actor.id) });
    await this.log(actor, 'schedule-rule:create', 'schedule-rule', item.id, { classId: item.classId });
    return this.ruleView(item);
  }

  async updateRule(id: string, dto: SaveScheduleRuleDto, actor: RequestUser) {
    const current = await this.prisma.classScheduleRule.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('排课规则不存在');
    await Promise.all([
      this.dataScope.assertAcademicClassAccessible(actor, current.classId),
      this.validateRule(dto, actor, {
        retainInactiveLessonTypeId: current.lessonTypeId,
        retainUnavailableUnitTemplateId: current.unitTemplateId ?? undefined,
      }),
    ]);
    const item = await this.prisma.classScheduleRule.update({
      where: { id },
      data: { ...this.ruleData(dto, actor.id), createdBy: undefined },
    });
    await this.log(actor, 'schedule-rule:update', 'schedule-rule', id, { classId: item.classId, status: item.status });
    return this.ruleView(item);
  }

  async generate(dto: GenerateSessionsDto, actor: RequestUser) {
    const from = this.safeDate(dto.from);
    const to = this.safeDate(dto.to);
    if (to < from) throw new BadRequestException('结束日期不能早于开始日期');
    if ((to.getTime() - from.getTime()) / 86_400_000 > 366) throw new BadRequestException('单次最多生成 366 天课次');

    const classIds = await this.dataScope.academicClassIdsFor(actor);
    if (dto.classId && classIds !== null && !classIds.includes(dto.classId)) {
      throw new BadRequestException('班级不在当前数据范围内');
    }
    const rules = await this.prisma.classScheduleRule.findMany({
      where: {
        id: dto.ruleId,
        classId: dto.classId ?? (classIds === null ? undefined : { in: classIds }),
        status: ScheduleRuleStatus.ACTIVE,
        effectiveFrom: { lte: to },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
      include: {
        classGroup: { select: { name: true, courseId: true } },
        lessonType: { select: { id: true, active: true } },
        unitTemplate: { select: { id: true, name: true, courseId: true, legacyUnscoped: true, status: true } },
      },
    });
    if (dto.ruleId && rules.length === 0) throw new NotFoundException('可用排课规则不存在');

    const rows: Prisma.LessonSessionCreateManyInput[] = [];
    for (const rule of rules) {
      this.assertCatalogAvailability(rule.lessonType, rule.unitTemplate);
      this.assertUnitCourseScope(rule.classGroup.courseId, rule.unitTemplate);
      const ruleFrom = rule.effectiveFrom > from ? rule.effectiveFrom : from;
      const ruleTo = rule.effectiveTo && rule.effectiveTo < to ? rule.effectiveTo : to;
      for (let day = ruleFrom; day <= ruleTo; day = addUtcDays(day, 1)) {
        if (day.getUTCDay() !== rule.weekday) continue;
        const date = formatDateOnly(day);
        rows.push({
          classId: rule.classId,
          teacherId: rule.teacherId,
          lessonTypeId: rule.lessonTypeId,
          unitTemplateId: rule.unitTemplateId,
          scheduleRuleId: rule.id,
          generationKey: `rule:${rule.id}:${date}`,
          title: rule.unitTemplate?.name ?? `${rule.classGroup.name}课程`,
          kind: LessonSessionKind.REGULAR,
          startsAt: this.safeZoned(date, rule.startMinute, rule.timezone),
          endsAt: this.safeZoned(date, rule.endMinute, rule.timezone),
          timezone: rule.timezone,
          lessonHours: rule.lessonHours,
          classroom: rule.classroom,
          createdBy: actor.id,
          updatedBy: actor.id,
        });
      }
    }

    const keys = rows.map((row) => row.generationKey);
    const existing = keys.length
      ? await this.prisma.lessonSession.count({ where: { generationKey: { in: keys } } })
      : 0;
    const created = rows.length ? await this.prisma.lessonSession.createMany({ data: rows, skipDuplicates: true }) : { count: 0 };
    await this.log(actor, 'lesson-session:generate', 'lesson-session-batch', undefined, {
      from: dto.from,
      to: dto.to,
      candidates: rows.length,
      created: created.count,
    });
    return { candidates: rows.length, created: created.count, skipped: Math.max(existing, rows.length - created.count) };
  }

  async listSessions(query: QuerySessionDto, actor: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const classIds = await this.dataScope.academicClassIdsFor(actor);
    if (query.classId && classIds !== null && !classIds.includes(query.classId)) {
      throw new BadRequestException('班级不在当前数据范围内');
    }
    const where: Prisma.LessonSessionWhereInput = {
      classId: query.classId ?? (classIds === null ? undefined : { in: classIds }),
      teacherId: query.teacherId,
      status: query.status,
      startsAt: query.from || query.to
        ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lessonSession.findMany({ where, include: sessionInclude, orderBy: { startsAt: 'asc' }, skip, take }),
      this.prisma.lessonSession.count({ where }),
    ]);
    return { items: items.map(this.sessionView), page, pageSize, total };
  }

  async createSession(dto: CreateSessionDto, actor: RequestUser) {
    await this.validateSessionReferences(dto, actor);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertTimeRange(startsAt, endsAt);
    const item = await this.prisma.lessonSession.create({
      data: {
        classId: dto.classId,
        teacherId: dto.teacherId,
        lessonTypeId: dto.lessonTypeId,
        unitTemplateId: dto.unitTemplateId,
        generationKey: `manual:${randomUUID()}`,
        title: dto.title.trim(),
        kind: dto.kind ?? LessonSessionKind.TEMPORARY,
        startsAt,
        endsAt,
        timezone: dto.timezone ?? 'Asia/Shanghai',
        lessonHours: dto.lessonHours,
        classroom: dto.classroom?.trim(),
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      include: sessionInclude,
    });
    await this.log(actor, 'lesson-session:create', 'lesson-session', item.id, { classId: item.classId });
    return this.sessionView(item);
  }

  async reschedule(id: string, dto: RescheduleSessionDto, actor: RequestUser) {
    const source = await this.sessionForWrite(id, actor);
    if (source.status === LessonSessionStatus.COMPLETED || source.status === LessonSessionStatus.CANCELLED) {
      throw new ConflictException('已完成或已取消课次不能调课');
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertTimeRange(startsAt, endsAt);
    await this.validateSessionReferences({
      classId: source.classId,
      teacherId: dto.teacherId ?? source.teacherId ?? undefined,
      lessonTypeId: source.lessonTypeId,
      unitTemplateId: source.unitTemplateId ?? undefined,
    }, actor, {
      retainInactiveLessonTypeId: source.lessonTypeId,
      retainUnavailableUnitTemplateId: source.unitTemplateId ?? undefined,
    });
    const key = `reschedule:${source.id}:${startsAt.toISOString()}`;
    const item = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.lessonSession.findUnique({ where: { generationKey: key }, include: sessionInclude });
      if (existing) return existing;
      await tx.lessonSession.update({
        where: { id: source.id },
        data: { status: LessonSessionStatus.RESCHEDULED, cancelReason: dto.reason.trim(), updatedBy: actor.id },
      });
      return tx.lessonSession.create({
        data: {
          classId: source.classId,
          teacherId: dto.teacherId ?? source.teacherId,
          lessonTypeId: source.lessonTypeId,
          unitTemplateId: source.unitTemplateId,
          sourceSessionId: source.id,
          generationKey: key,
          title: source.title,
          kind: source.kind,
          startsAt,
          endsAt,
          timezone: source.timezone,
          lessonHours: source.lessonHours,
          classroom: dto.classroom?.trim() ?? source.classroom,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        include: sessionInclude,
      });
    });
    await this.log(actor, 'lesson-session:reschedule', 'lesson-session', id, { replacementId: item.id, reason: dto.reason });
    return this.sessionView(item);
  }

  async cancel(id: string, dto: CancelSessionDto, actor: RequestUser) {
    const source = await this.sessionForWrite(id, actor);
    if (source.status === LessonSessionStatus.COMPLETED) throw new ConflictException('已完成课次不能取消');
    const item = await this.prisma.lessonSession.update({
      where: { id },
      data: { status: LessonSessionStatus.CANCELLED, cancelReason: dto.reason.trim(), updatedBy: actor.id },
    });
    await this.log(actor, 'lesson-session:cancel', 'lesson-session', id, { reason: dto.reason });
    return { id: item.id, status: item.status };
  }

  async makeup(id: string, dto: MakeupSessionDto, actor: RequestUser) {
    const source = await this.sessionForWrite(id, actor);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertTimeRange(startsAt, endsAt);
    await this.validateSessionReferences({
      classId: source.classId,
      teacherId: dto.teacherId ?? source.teacherId ?? undefined,
      lessonTypeId: source.lessonTypeId,
      unitTemplateId: source.unitTemplateId ?? undefined,
    }, actor, {
      retainInactiveLessonTypeId: source.lessonTypeId,
      retainUnavailableUnitTemplateId: source.unitTemplateId ?? undefined,
    });
    const key = `makeup:${source.id}:${startsAt.toISOString()}`;
    const item = await this.prisma.lessonSession.upsert({
      where: { generationKey: key },
      update: {},
      create: {
        classId: source.classId,
        teacherId: dto.teacherId ?? source.teacherId,
        lessonTypeId: source.lessonTypeId,
        unitTemplateId: source.unitTemplateId,
        sourceSessionId: source.id,
        generationKey: key,
        title: `${source.title}（补课）`,
        kind: LessonSessionKind.MAKEUP,
        startsAt,
        endsAt,
        timezone: source.timezone,
        lessonHours: source.lessonHours,
        classroom: dto.classroom?.trim() ?? source.classroom,
        createdBy: actor.id,
        updatedBy: actor.id,
      },
      include: sessionInclude,
    });
    await this.log(actor, 'lesson-session:makeup', 'lesson-session', id, { makeupId: item.id, reason: dto.reason });
    return this.sessionView(item);
  }

  private async validateRule(
    dto: SaveScheduleRuleDto,
    actor: RequestUser,
    options: ReferenceValidationOptions = {},
  ) {
    if (dto.endMinute <= dto.startMinute) throw new BadRequestException('结束时间必须晚于开始时间');
    const from = this.safeDate(dto.effectiveFrom);
    const to = dto.effectiveTo ? this.safeDate(dto.effectiveTo) : undefined;
    if (to && to < from) throw new BadRequestException('规则结束日期不能早于开始日期');
    await this.validateSessionReferences(dto, actor, options);
  }

  private async validateSessionReferences(
    dto: Pick<SaveScheduleRuleDto, 'classId' | 'teacherId' | 'lessonTypeId' | 'unitTemplateId'>,
    actor: RequestUser,
    options: ReferenceValidationOptions = {},
  ) {
    await this.dataScope.assertAcademicClassAccessible(actor, dto.classId);
    const [classGroup, lessonType, unit, teacher] = await Promise.all([
      this.prisma.classGroup.findFirst({
        where: { id: dto.classId, deletedAt: null },
        select: { courseId: true },
      }),
      this.prisma.lessonType.findUnique({ where: { id: dto.lessonTypeId }, select: { id: true, active: true } }),
      dto.unitTemplateId
        ? this.prisma.courseUnitTemplate.findUnique({
            where: { id: dto.unitTemplateId },
            select: { id: true, lessonTypeId: true, courseId: true, legacyUnscoped: true, status: true },
          })
        : Promise.resolve(null),
      dto.teacherId
        ? this.prisma.classTeacher.findFirst({ where: { classId: dto.classId, teacherId: dto.teacherId, status: 'ACTIVE' }, select: { id: true } })
        : Promise.resolve({ id: 'none' }),
    ]);
    if (!classGroup) throw new BadRequestException('班级不存在');
    if (!lessonType) throw new BadRequestException('课型不存在');
    if (dto.unitTemplateId && !unit) throw new BadRequestException('课程单元不存在');
    this.assertCatalogAvailability(lessonType, unit, options);
    if (unit && unit.lessonTypeId !== dto.lessonTypeId) throw new BadRequestException('课程单元与课型不一致');
    this.assertUnitCourseScope(classGroup.courseId, unit);
    if (!teacher) throw new BadRequestException('教师未在该班级任教');
  }

  private assertCatalogAvailability(
    lessonType: { id: string; active: boolean },
    unit: { id: string; status: CourseUnitStatus } | null,
    options: ReferenceValidationOptions = {},
  ) {
    if (!lessonType.active && lessonType.id !== options.retainInactiveLessonTypeId) {
      throw new BadRequestException('课型已停用，不能用于新排课');
    }
    if (unit && unit.status !== CourseUnitStatus.ACTIVE && unit.id !== options.retainUnavailableUnitTemplateId) {
      throw new BadRequestException('课程单元已禁用或归档，不能用于新排课');
    }
  }

  private assertUnitCourseScope(
    classCourseId: string | null,
    unit: { courseId: string | null; legacyUnscoped: boolean } | null,
  ) {
    if (!unit) return;
    if (unit.courseId === null && unit.legacyUnscoped) return;
    if (!classCourseId) throw new BadRequestException('班级未关联课程，不能使用课程单元');
    if (unit.courseId !== classCourseId) {
      throw new BadRequestException('课程单元与班级所属课程不一致');
    }
  }

  private async sessionForWrite(id: string, actor: RequestUser) {
    const item = await this.prisma.lessonSession.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('课次不存在');
    await this.dataScope.assertAcademicClassAccessible(actor, item.classId);
    return item;
  }

  private ruleData(dto: SaveScheduleRuleDto, actorId: string): Prisma.ClassScheduleRuleUncheckedCreateInput {
    return {
      classId: dto.classId,
      teacherId: dto.teacherId,
      lessonTypeId: dto.lessonTypeId,
      unitTemplateId: dto.unitTemplateId,
      weekday: dto.weekday,
      startMinute: dto.startMinute,
      endMinute: dto.endMinute,
      effectiveFrom: this.safeDate(dto.effectiveFrom),
      effectiveTo: dto.effectiveTo ? this.safeDate(dto.effectiveTo) : undefined,
      timezone: dto.timezone ?? 'Asia/Shanghai',
      lessonHours: dto.lessonHours,
      classroom: dto.classroom?.trim(),
      status: dto.status,
      createdBy: actorId,
      updatedBy: actorId,
    };
  }

  private ruleView(item: { lessonHours: Prisma.Decimal } & Record<string, unknown>) {
    return { ...item, lessonHours: Number(item.lessonHours) };
  }

  private sessionView(item: { lessonHours: Prisma.Decimal } & Record<string, unknown>) {
    return { ...item, lessonHours: Number(item.lessonHours) };
  }

  private safeDate(value: string) {
    try {
      return parseDateOnly(value);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '日期无效');
    }
  }

  private safeZoned(date: string, minute: number, timezone: string) {
    try {
      return zonedDateTime(date, minute, timezone);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : '时区或时间无效');
    }
  }

  private assertTimeRange(startsAt: Date, endsAt: Date) {
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      throw new BadRequestException('课次结束时间必须晚于开始时间');
    }
  }

  private log(actor: RequestUser, action: string, targetType: string, targetId?: string, afterData?: Prisma.InputJsonValue) {
    return this.audit.log({ userId: actor.id, action, module: 'academic-operations', targetType, targetId, afterData });
  }
}
