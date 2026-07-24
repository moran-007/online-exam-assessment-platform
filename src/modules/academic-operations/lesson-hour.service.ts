import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { LessonHourLedgerType, Prisma } from '@prisma/client';
import { toPagination } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLessonHourAdjustmentDto, QueryLessonHourDto, ReconcileLessonHoursDto } from './dto/lesson-hour.dto';

const CREDIT_TYPES = new Set<LessonHourLedgerType>([
  LessonHourLedgerType.OPENING_BALANCE,
  LessonHourLedgerType.PURCHASE,
  LessonHourLedgerType.GIFT,
  LessonHourLedgerType.TRANSFER_IN,
]);
const DEBIT_TYPES = new Set<LessonHourLedgerType>([
  LessonHourLedgerType.REFUND,
  LessonHourLedgerType.TRANSFER_OUT,
]);

@Injectable()
export class LessonHourService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async listLedger(query: QueryLessonHourDto, actor: RequestUser) {
    const { page, pageSize, skip, take } = toPagination(query);
    const where = await this.scopedWhere(query, actor);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lessonHourLedger.findMany({
        where,
        include: {
          student: { select: { username: true, realName: true } },
          classGroup: { select: { name: true } },
          session: { select: { title: true, startsAt: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.lessonHourLedger.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        amount: Number(item.amount),
        studentName: item.student.realName ?? item.student.username,
        className: item.classGroup?.name ?? '',
        sessionTitle: item.session?.title ?? '',
      })),
      page,
      pageSize,
      total,
    };
  }

  async balances(query: QueryLessonHourDto, actor: RequestUser) {
    const where = await this.scopedWhere(query, actor);
    const grouped = await this.prisma.lessonHourLedger.groupBy({
      by: ['studentId'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { studentId: 'asc' },
    });
    const scopedStudentIds = await this.balanceStudentIds(query, actor);
    const users = await this.prisma.user.findMany({
      where: {
        id: scopedStudentIds === null ? undefined : { in: scopedStudentIds },
        userType: 'STUDENT',
        deletedAt: null,
      },
      select: { id: true, username: true, realName: true },
      orderBy: [{ realName: 'asc' }, { username: 'asc' }],
    });
    const groupedByStudent = new Map(grouped.map((item) => [item.studentId, item]));
    return users.map((user) => {
      const item = groupedByStudent.get(user.id);
      return {
        studentId: user.id,
        studentName: user.realName ?? user.username,
        balance: Number(item?._sum.amount ?? 0),
        entryCount: item?._count._all ?? 0,
      };
    });
  }

  async adjust(dto: CreateLessonHourAdjustmentDto, actor: RequestUser) {
    await this.dataScope.assertStudentAccessible(actor, dto.studentId);
    if (dto.classId) await this.dataScope.assertAcademicClassAccessible(actor, dto.classId);
    const amount = this.normalizeAdjustment(dto.type, dto.amount);
    const current = await this.prisma.lessonHourLedger.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
    if (current) {
      const same = current.studentId === dto.studentId && current.type === dto.type && current.amount.equals(amount);
      if (!same) throw new ConflictException('幂等键已被其他课时操作使用');
      return { id: current.id, amount: Number(current.amount), idempotent: true };
    }

    const item = await this.prisma.lessonHourLedger.create({
      data: {
        studentId: dto.studentId,
        courseId: dto.courseId,
        classId: dto.classId,
        type: dto.type,
        amount,
        idempotencyKey: dto.idempotencyKey.trim(),
        note: dto.note?.trim(),
        createdBy: actor.id,
      },
    });
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-hour:adjust',
      module: 'academic-operations',
      targetType: 'lesson-hour-ledger',
      targetId: item.id,
      afterData: { studentId: item.studentId, type: item.type, amount: Number(item.amount) },
    });
    return { id: item.id, amount: Number(item.amount), idempotent: false };
  }

  async reconcile(dto: ReconcileLessonHoursDto, actor: RequestUser) {
    if (dto.expectedBalance !== undefined && !dto.studentId) {
      throw new BadRequestException('指定预期余额时必须同时指定学生');
    }
    const query = Object.assign(new QueryLessonHourDto(), { studentId: dto.studentId });
    const where = await this.scopedWhere(query, actor);
    const [balances, reversals] = await Promise.all([
      this.balances(query, actor),
      this.prisma.lessonHourLedger.findMany({
        where: { ...where, type: LessonHourLedgerType.REVERSAL },
        include: { reversalOf: { select: { amount: true } } },
      }),
    ]);
    const invalidReversals = reversals.filter(
      (item) => !item.reversalOf || !item.amount.plus(item.reversalOf.amount).isZero(),
    );
    const items = balances.map((item) => {
      const expected = dto.studentId === item.studentId && dto.expectedBalance !== undefined
        ? dto.expectedBalance
        : item.balance;
      const difference = Number(new Prisma.Decimal(item.balance).minus(expected));
      return { ...item, expectedBalance: expected, difference, passed: difference === 0 };
    });
    if (dto.studentId && items.length === 0) {
      const expected = dto.expectedBalance ?? 0;
      items.push({
        studentId: dto.studentId,
        studentName: '',
        balance: 0,
        entryCount: 0,
        expectedBalance: expected,
        difference: -expected,
        passed: expected === 0,
      });
    }
    const report = {
      generatedAt: new Date(),
      passed: invalidReversals.length === 0 && items.every((item) => item.passed),
      invalidReversalCount: invalidReversals.length,
      items,
    };
    await this.audit.log({
      userId: actor.id,
      action: 'lesson-hour:reconcile',
      module: 'academic-operations',
      targetType: 'lesson-hour-ledger',
      afterData: { passed: report.passed, students: items.length, invalidReversalCount: invalidReversals.length },
    });
    return report;
  }

  private async scopedWhere(query: QueryLessonHourDto, actor: RequestUser): Promise<Prisma.LessonHourLedgerWhereInput> {
    const [studentIds, classIds] = await Promise.all([
      this.dataScope.studentIdsFor(actor),
      this.dataScope.academicClassIdsFor(actor),
    ]);
    if (query.studentId && studentIds !== null && !studentIds.includes(query.studentId)) {
      throw new BadRequestException('学生不在当前数据范围内');
    }
    if (query.classId && classIds !== null && !classIds.includes(query.classId)) {
      throw new BadRequestException('班级不在当前数据范围内');
    }
    return {
      studentId: query.studentId ?? (studentIds === null ? undefined : { in: studentIds }),
      classId: query.classId,
      type: query.type,
    };
  }

  private async balanceStudentIds(query: QueryLessonHourDto, actor: RequestUser) {
    if (query.studentId) return [query.studentId];
    if (query.classId) {
      const memberships = await this.prisma.classStudent.findMany({
        where: { classId: query.classId, status: 'ACTIVE' },
        select: { studentId: true },
      });
      return memberships.map((item) => item.studentId);
    }
    return this.dataScope.studentIdsFor(actor);
  }

  private normalizeAdjustment(type: LessonHourLedgerType, input: number) {
    if (!Number.isFinite(input) || input === 0) throw new BadRequestException('课时变动不能为 0');
    if (type === LessonHourLedgerType.CONSUME || type === LessonHourLedgerType.REVERSAL) {
      throw new BadRequestException('扣减与冲正只能由考勤流程产生');
    }
    if (CREDIT_TYPES.has(type)) return Math.abs(input);
    if (DEBIT_TYPES.has(type)) return -Math.abs(input);
    return input;
  }
}
