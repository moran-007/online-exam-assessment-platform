import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CourseUnitStatus,
  KnowledgePointStatus,
  LessonSessionKind,
  LessonSessionStatus,
  Prisma,
  ScheduleRuleStatus,
} from '@prisma/client';
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
  classGroup: { select: { name: true, course: { select: { id: true, name: true } } } },
  teacher: { select: { realName: true, username: true } },
  lessonType: { select: { name: true, countInStatistics: true } },
  unitTemplate: { select: { name: true } },
  knowledgePoint: { select: { id: true, name: true, code: true, sortOrder: true } },
  _count: { select: { attendance: true } },
} as const;

type ReferenceValidationOptions = {
  retainInactiveLessonTypeId?: string;
  retainUnavailableUnitTemplateId?: string;
};

type ScheduleReferenceInput = {
  classId: string;
  teacherId?: string;
  lessonTypeId: string;
  unitTemplateId?: string;
  knowledgePointId?: string;
};

type SchedulableKnowledgePoint = {
  id: string;
  name: string;
  code: string;
  level: number;
  sortOrder: number;
  sequence: number;
};

@Injectable()
export class LessonScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async context(classId: string, actor: RequestUser) {
    await this.dataScope.assertAcademicClassAccessible(actor, classId);
    const classGroup = await this.prisma.classGroup.findFirst({
      where: { id: classId, deletedAt: null },
      select: {
        id: true,
        name: true,
        course: { select: { id: true, name: true, code: true } },
        teachers: {
          where: { status: 'ACTIVE' },
          orderBy: { joinedAt: 'asc' },
          select: {
            role: true,
            teacher: { select: { id: true, username: true, realName: true } },
          },
        },
      },
    });
    if (!classGroup) throw new NotFoundException('班级不存在');
    const knowledgePoints = classGroup.course
      ? await this.orderedSchedulableKnowledgePoints(classGroup.course.id)
      : [];
    return {
      classId: classGroup.id,
      className: classGroup.name,
      course: classGroup.course,
      teachers: classGroup.teachers.map(({ teacher, role }) => ({ ...teacher, role })),
      knowledgePoints,
    };
  }

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
      classGroup: { select: { name: true, course: { select: { id: true, name: true } } } },
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
        unitTemplate: {
          select: { id: true, name: true, courseId: true, legacyUnscoped: true, status: true, lessonTypeId: true },
        },
      },
    });
    if (dto.ruleId && rules.length === 0) throw new NotFoundException('可用排课规则不存在');
    if (Boolean(dto.startKnowledgePointId) !== Boolean(dto.sessionCount)) {
      throw new BadRequestException('顺序排课必须同时指定起始知识点和课次数');
    }
    if (dto.startKnowledgePointId && rules.length !== 1) {
      throw new BadRequestException('顺序排课必须指定一条排课规则');
    }

    const rows: Prisma.LessonSessionCreateManyInput[] = [];
    for (const rule of rules) {
      this.assertCatalogAvailability(rule.lessonType, null);
      const legacyUnit = this.usableLegacyUnit(rule.classGroup.courseId, rule.lessonTypeId, rule.unitTemplate);
      let knowledgeSequence: SchedulableKnowledgePoint[] | null = null;
      if (dto.startKnowledgePointId && dto.sessionCount) {
        if (!rule.classGroup.courseId) throw new BadRequestException('班级未关联课程，不能顺序排课');
        const ordered = await this.orderedSchedulableKnowledgePoints(rule.classGroup.courseId);
        const startIndex = ordered.findIndex((item) => item.id === dto.startKnowledgePointId);
        if (startIndex < 0) throw new BadRequestException('起始知识点不属于班级课程，或该节点不是可排课知识点');
        knowledgeSequence = ordered.slice(startIndex, startIndex + dto.sessionCount);
        if (knowledgeSequence.length < dto.sessionCount) {
          throw new BadRequestException(`从所选位置起仅剩 ${knowledgeSequence.length} 个可排知识点`);
        }
      }
      const ruleFrom = rule.effectiveFrom > from ? rule.effectiveFrom : from;
      const ruleTo = rule.effectiveTo && rule.effectiveTo < to ? rule.effectiveTo : to;
      let sequenceIndex = 0;
      for (let day = ruleFrom; day <= ruleTo; day = addUtcDays(day, 1)) {
        if (day.getUTCDay() !== rule.weekday) continue;
        const knowledgePoint = knowledgeSequence?.[sequenceIndex];
        if (knowledgeSequence && !knowledgePoint) break;
        const date = formatDateOnly(day);
        rows.push({
          classId: rule.classId,
          teacherId: rule.teacherId,
          lessonTypeId: rule.lessonTypeId,
          unitTemplateId: legacyUnit?.id,
          knowledgePointId: knowledgePoint?.id,
          scheduleRuleId: rule.id,
          generationKey: `rule:${rule.id}:${date}`,
          title: knowledgePoint?.name ?? legacyUnit?.name ?? `${rule.classGroup.name}课程`,
          kind: LessonSessionKind.REGULAR,
          startsAt: this.safeZoned(date, rule.startMinute, rule.timezone),
          endsAt: this.safeZoned(date, rule.endMinute, rule.timezone),
          timezone: rule.timezone,
          lessonHours: rule.lessonHours,
          classroom: rule.classroom,
          createdBy: actor.id,
          updatedBy: actor.id,
        });
        sequenceIndex += 1;
      }
      if (knowledgeSequence && sequenceIndex < knowledgeSequence.length) {
        throw new BadRequestException(`所选日期范围内仅有 ${sequenceIndex} 个符合规则的上课时段`);
      }
    }

    const keys = rows.map((row) => row.generationKey);
    const existing = keys.length
      ? await this.prisma.lessonSession.count({ where: { generationKey: { in: keys } } })
      : 0;
    for (const [index, row] of rows.entries()) {
      await this.assertNoScheduleConflict({
        teacherId: row.teacherId ?? undefined,
        classroom: row.classroom ?? undefined,
        startsAt: new Date(row.startsAt),
        endsAt: new Date(row.endsAt),
        generationKey: row.generationKey,
      });
      const earlier = rows.slice(0, index).find((candidate) =>
        new Date(candidate.startsAt) < new Date(row.endsAt) && new Date(candidate.endsAt) > new Date(row.startsAt)
        && ((row.teacherId && candidate.teacherId === row.teacherId)
          || (row.classroom && candidate.classroom?.trim() === row.classroom.trim())));
      if (earlier) {
        throw new ConflictException(earlier.teacherId && earlier.teacherId === row.teacherId
          ? '教师在该时间段已有课程'
          : '教室在该时间段已被占用');
      }
    }
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
    await this.assertNoScheduleConflict({
      teacherId: dto.teacherId,
      classroom: dto.classroom,
      startsAt,
      endsAt,
    });
    const item = await this.prisma.lessonSession.create({
      data: {
        classId: dto.classId,
        teacherId: dto.teacherId,
        lessonTypeId: dto.lessonTypeId,
        unitTemplateId: dto.unitTemplateId,
        knowledgePointId: dto.knowledgePointId,
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
      knowledgePointId: source.knowledgePointId ?? undefined,
    }, actor, {
      retainInactiveLessonTypeId: source.lessonTypeId,
      retainUnavailableUnitTemplateId: source.unitTemplateId ?? undefined,
    });
    const key = `reschedule:${source.id}:${startsAt.toISOString()}`;
    await this.assertNoScheduleConflict({
      teacherId: dto.teacherId ?? source.teacherId ?? undefined,
      classroom: dto.classroom?.trim() ?? source.classroom ?? undefined,
      startsAt,
      endsAt,
      excludeId: source.id,
      generationKey: key,
    });
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
          knowledgePointId: source.knowledgePointId,
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
      knowledgePointId: source.knowledgePointId ?? undefined,
    }, actor, {
      retainInactiveLessonTypeId: source.lessonTypeId,
      retainUnavailableUnitTemplateId: source.unitTemplateId ?? undefined,
    });
    const key = `makeup:${source.id}:${startsAt.toISOString()}`;
    await this.assertNoScheduleConflict({
      teacherId: dto.teacherId ?? source.teacherId ?? undefined,
      classroom: dto.classroom?.trim() ?? source.classroom ?? undefined,
      startsAt,
      endsAt,
      generationKey: key,
    });
    const item = await this.prisma.lessonSession.upsert({
      where: { generationKey: key },
      update: {},
      create: {
        classId: source.classId,
        teacherId: dto.teacherId ?? source.teacherId,
        lessonTypeId: source.lessonTypeId,
        unitTemplateId: source.unitTemplateId,
        knowledgePointId: source.knowledgePointId,
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
    dto: ScheduleReferenceInput,
    actor: RequestUser,
    options: ReferenceValidationOptions = {},
  ) {
    await this.dataScope.assertAcademicClassAccessible(actor, dto.classId);
    const [classGroup, lessonType, unit, knowledgePoint, teacher] = await Promise.all([
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
      dto.knowledgePointId
        ? this.prisma.knowledgePoint.findFirst({
            where: { id: dto.knowledgePointId, deletedAt: null },
            select: {
              id: true,
              courseId: true,
              status: true,
              _count: { select: { children: { where: { deletedAt: null, status: KnowledgePointStatus.ACTIVE } } } },
            },
          })
        : Promise.resolve(null),
      dto.teacherId
        ? this.prisma.classTeacher.findFirst({ where: { classId: dto.classId, teacherId: dto.teacherId, status: 'ACTIVE' }, select: { id: true } })
        : Promise.resolve({ id: 'none' }),
    ]);
    if (!classGroup) throw new BadRequestException('班级不存在');
    if (!lessonType) throw new BadRequestException('课型不存在');
    if (dto.unitTemplateId && !unit) throw new BadRequestException('课程单元不存在');
    if (dto.knowledgePointId && !knowledgePoint) throw new BadRequestException('课程知识点不存在');
    this.assertCatalogAvailability(lessonType, unit, options);
    if (unit && unit.lessonTypeId !== dto.lessonTypeId) throw new BadRequestException('课程单元与课型不一致');
    this.assertUnitCourseScope(classGroup.courseId, unit);
    if (knowledgePoint) {
      if (knowledgePoint.status !== KnowledgePointStatus.ACTIVE) {
        throw new BadRequestException('课程知识点已停用');
      }
      if (knowledgePoint._count.children > 0) {
        throw new BadRequestException('请选择具体知识点，章节不能直接排课');
      }
      if (!classGroup.courseId || knowledgePoint.courseId !== classGroup.courseId) {
        throw new BadRequestException('课程知识点与班级所属课程不一致');
      }
    }
    if (!teacher) throw new BadRequestException('教师未在该班级任教');
  }

  private async orderedSchedulableKnowledgePoints(courseId: string): Promise<SchedulableKnowledgePoint[]> {
    const points = await this.prisma.knowledgePoint.findMany({
      where: { courseId, deletedAt: null, status: KnowledgePointStatus.ACTIVE },
      select: { id: true, parentId: true, name: true, code: true, level: true, sortOrder: true, createdAt: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const ids = new Set(points.map((item) => item.id));
    const children = new Map<string | null, typeof points>();
    for (const point of points) {
      const parentId = point.parentId && ids.has(point.parentId) ? point.parentId : null;
      const siblings = children.get(parentId) ?? [];
      siblings.push(point);
      children.set(parentId, siblings);
    }
    const stableSort = (items: typeof points) => items.sort((left, right) =>
      left.sortOrder - right.sortOrder
      || left.createdAt.getTime() - right.createdAt.getTime()
      || left.name.localeCompare(right.name, 'zh-CN')
      || left.id.localeCompare(right.id),
    );
    const ordered: SchedulableKnowledgePoint[] = [];
    const visit = (point: (typeof points)[number]) => {
      const descendants = stableSort(children.get(point.id) ?? []);
      if (descendants.length === 0) {
        ordered.push({
          id: point.id,
          name: point.name,
          code: point.code,
          level: point.level,
          sortOrder: point.sortOrder,
          sequence: ordered.length + 1,
        });
        return;
      }
      descendants.forEach(visit);
    };
    stableSort(children.get(null) ?? []).forEach(visit);
    return ordered;
  }

  private usableLegacyUnit(
    classCourseId: string | null,
    lessonTypeId: string,
    unit: {
      id: string;
      name: string;
      courseId: string | null;
      legacyUnscoped: boolean;
      status: CourseUnitStatus;
      lessonTypeId: string;
    } | null,
  ) {
    if (!unit || unit.status !== CourseUnitStatus.ACTIVE || unit.lessonTypeId !== lessonTypeId) return null;
    if (unit.courseId === null && unit.legacyUnscoped) return unit;
    return unit.courseId === classCourseId ? unit : null;
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
      unitTemplateId: dto.unitTemplateId ?? null,
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

  private async assertNoScheduleConflict(input: {
    teacherId?: string;
    classroom?: string;
    startsAt: Date;
    endsAt: Date;
    excludeId?: string;
    generationKey?: string;
  }) {
    const classroom = input.classroom?.trim();
    if (!input.teacherId && !classroom) return;
    const base: Prisma.LessonSessionWhereInput = {
      id: input.excludeId ? { not: input.excludeId } : undefined,
      generationKey: input.generationKey ? { not: input.generationKey } : undefined,
      status: { in: [LessonSessionStatus.PLANNED, LessonSessionStatus.COMPLETED] },
      startsAt: { lt: input.endsAt },
      endsAt: { gt: input.startsAt },
    };
    if (input.teacherId) {
      const teacherConflict = await this.prisma.lessonSession.findFirst({
        where: { ...base, teacherId: input.teacherId },
        select: { id: true },
      });
      if (teacherConflict) throw new ConflictException('教师在该时间段已有课程');
    }
    if (classroom) {
      const classroomConflict = await this.prisma.lessonSession.findFirst({
        where: { ...base, classroom },
        select: { id: true },
      });
      if (classroomConflict) throw new ConflictException('教室在该时间段已被占用');
    }
  }

  private log(actor: RequestUser, action: string, targetType: string, targetId?: string, afterData?: Prisma.InputJsonValue) {
    return this.audit.log({ userId: actor.id, action, module: 'academic-operations', targetType, targetId, afterData });
  }
}
