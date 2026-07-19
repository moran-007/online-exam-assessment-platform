import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceStatus,
  ClassMemberStatus,
  LessonHourLedgerType,
  LessonSessionStatus,
  Prisma,
} from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmAttendanceDto, CorrectAttendanceDto } from './dto/attendance.dto';

const BILLABLE_STATUSES = new Set<AttendanceStatus>([
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
  AttendanceStatus.MAKEUP,
]);

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly audit: AuditService,
  ) {}

  async listForSession(sessionId: string, actor: RequestUser) {
    const session = await this.prisma.lessonSession.findUnique({
      where: { id: sessionId },
      include: {
        classGroup: { select: { name: true } },
        lessonType: { select: { name: true, countInStatistics: true } },
      },
    });
    if (!session) throw new NotFoundException('课次不存在');
    await this.dataScope.assertAcademicClassAccessible(actor, session.classId);

    const visibleStudentIds = await this.dataScope.studentIdsFor(actor);
    const memberships = await this.prisma.classStudent.findMany({
      where: {
        classId: session.classId,
        status: ClassMemberStatus.ACTIVE,
        studentId: visibleStudentIds === null ? undefined : { in: visibleStudentIds },
      },
      include: {
        student: { select: { id: true, username: true, realName: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
    const records = await this.prisma.attendanceRecord.findMany({
      where: { sessionId, studentId: { in: memberships.map((item) => item.studentId) } },
      include: { _count: { select: { revisions: true } } },
    });
    const recordByStudent = new Map(records.map((record) => [record.studentId, record]));
    return {
      session: {
        id: session.id,
        classId: session.classId,
        className: session.classGroup.name,
        lessonTypeName: session.lessonType.name,
        startsAt: session.startsAt,
        lessonHours: Number(session.lessonHours),
        status: session.status,
      },
      records: memberships.map((membership) => {
        const record = recordByStudent.get(membership.studentId);
        return {
          id: record?.id,
          studentId: membership.studentId,
          studentName: membership.student.realName ?? membership.student.username,
          status: record?.status ?? AttendanceStatus.UNCONFIRMED,
          deductHours: Number(record?.deductHours ?? 0),
          confirmedAt: record?.confirmedAt ?? null,
          version: record?.version ?? 0,
          revisionCount: record?._count.revisions ?? 0,
          legacyBaseline: record?.legacyBaseline ?? false,
        };
      }),
    };
  }

  async confirm(sessionId: string, dto: ConfirmAttendanceDto, actor: RequestUser) {
    const uniqueStudentIds = [...new Set(dto.records.map((record) => record.studentId))];
    if (uniqueStudentIds.length !== dto.records.length) throw new BadRequestException('同一学生不能重复提交考勤');

    const result = await this.serializable(async (tx) => {
      const session = await tx.lessonSession.findUnique({
        where: { id: sessionId },
        include: { lessonType: { select: { countInStatistics: true } } },
      });
      if (!session) throw new NotFoundException('课次不存在');
      if (session.status === LessonSessionStatus.CANCELLED || session.status === LessonSessionStatus.RESCHEDULED) {
        throw new ConflictException('已取消或已调课的课次不能确认考勤');
      }
      await this.dataScope.assertAcademicClassAccessible(actor, session.classId);
      await this.assertMembers(tx, session.classId, uniqueStudentIds);

      let confirmed = 0;
      let skipped = 0;
      for (const input of dto.records) {
        const deductHours = this.normalizeDeduct(input.status, input.deductHours, session.lessonHours, session.lessonType.countInStatistics);
        const current = await tx.attendanceRecord.findUnique({
          where: { sessionId_studentId: { sessionId, studentId: input.studentId } },
        });
        if (current?.confirmedAt) {
          if (current.status === input.status && current.deductHours.equals(deductHours)) {
            skipped += 1;
            continue;
          }
          throw new ConflictException('已确认考勤必须通过更正操作修改');
        }

        const attendance = current
          ? await tx.attendanceRecord.update({
              where: { id: current.id },
              data: { status: input.status, deductHours, confirmedAt: new Date(), confirmedBy: actor.id },
            })
          : await tx.attendanceRecord.create({
              data: {
                sessionId,
                studentId: input.studentId,
                status: input.status,
                deductHours,
                confirmedAt: new Date(),
                confirmedBy: actor.id,
              },
            });

        if (deductHours > 0 && !attendance.legacyBaseline) {
          await tx.lessonHourLedger.create({
            data: {
              studentId: input.studentId,
              classId: session.classId,
              sessionId,
              attendanceId: attendance.id,
              type: LessonHourLedgerType.CONSUME,
              amount: -deductHours,
              idempotencyKey: this.consumeKey(attendance.id, attendance.version),
              note: '考勤确认扣减',
              createdBy: actor.id,
            },
          });
        }
        confirmed += 1;
      }
      await tx.lessonSession.update({
        where: { id: sessionId },
        data: { status: LessonSessionStatus.COMPLETED, updatedBy: actor.id },
      });
      return { confirmed, skipped };
    });

    await this.audit.log({
      userId: actor.id,
      action: 'attendance:confirm',
      module: 'academic-operations',
      targetType: 'lesson-session',
      targetId: sessionId,
      afterData: result,
    });
    return result;
  }

  async correct(attendanceId: string, dto: CorrectAttendanceDto, actor: RequestUser) {
    const result = await this.serializable(async (tx) => {
      const current = await tx.attendanceRecord.findUnique({
        where: { id: attendanceId },
        include: {
          session: {
            select: {
              classId: true,
              lessonType: { select: { countInStatistics: true } },
            },
          },
        },
      });
      if (!current) throw new NotFoundException('考勤记录不存在');
      if (!current.confirmedAt) throw new ConflictException('尚未确认的考勤无需更正');
      await this.dataScope.assertAcademicClassAccessible(actor, current.session.classId);

      const nextDeduct = this.correctedDeduct(
        dto.status,
        dto.deductHours,
        current.session.lessonType.countInStatistics,
      );
      if (current.status === dto.status && current.deductHours.equals(nextDeduct)) {
        return { id: current.id, version: current.version, unchanged: true };
      }
      const nextVersion = current.version + 1;

      if (current.legacyBaseline) {
        const adjustment = current.deductHours.minus(nextDeduct);
        if (!adjustment.isZero()) {
          await tx.lessonHourLedger.create({
            data: {
              studentId: current.studentId,
              classId: current.session.classId,
              sessionId: current.sessionId,
              attendanceId: current.id,
              type: LessonHourLedgerType.MANUAL_ADJUSTMENT,
              amount: adjustment,
              idempotencyKey: `attendance:${current.id}:v${nextVersion}:legacy-delta`,
              note: `历史考勤更正：${dto.reason.trim()}`,
              createdBy: actor.id,
            },
          });
        }
      } else {
        await this.reverseCurrentConsumption(tx, current, actor.id, nextVersion, dto.reason);
        if (nextDeduct.greaterThan(0)) {
          await tx.lessonHourLedger.create({
            data: {
              studentId: current.studentId,
              classId: current.session.classId,
              sessionId: current.sessionId,
              attendanceId: current.id,
              type: LessonHourLedgerType.CONSUME,
              amount: nextDeduct.negated(),
              idempotencyKey: this.consumeKey(current.id, nextVersion),
              note: `考勤更正后扣减：${dto.reason.trim()}`,
              createdBy: actor.id,
            },
          });
        }
      }

      await tx.attendanceRevision.create({
        data: {
          attendanceId: current.id,
          version: nextVersion,
          beforeStatus: current.status,
          beforeDeductHours: current.deductHours,
          afterStatus: dto.status,
          afterDeductHours: nextDeduct,
          reason: dto.reason.trim(),
          correctedBy: actor.id,
        },
      });
      const updated = await tx.attendanceRecord.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          status: dto.status,
          deductHours: nextDeduct,
          correctionReason: dto.reason.trim(),
          confirmedBy: actor.id,
          confirmedAt: new Date(),
          version: nextVersion,
        },
      });
      if (updated.count !== 1) throw new ConflictException('考勤已被其他操作修改，请刷新后重试');
      return { id: current.id, version: nextVersion, unchanged: false };
    });

    await this.audit.log({
      userId: actor.id,
      action: 'attendance:correct',
      module: 'academic-operations',
      targetType: 'attendance',
      targetId: attendanceId,
      afterData: { status: dto.status, deductHours: dto.deductHours, reason: dto.reason, version: result.version },
    });
    return result;
  }

  private async reverseCurrentConsumption(
    tx: Prisma.TransactionClient,
    current: { id: string; studentId: string; sessionId: string; version: number; deductHours: Prisma.Decimal; session: { classId: string } },
    actorId: string,
    nextVersion: number,
    reason: string,
  ) {
    if (current.deductHours.lessThanOrEqualTo(0)) return;
    const consumed = await tx.lessonHourLedger.findUnique({
      where: { idempotencyKey: this.consumeKey(current.id, current.version) },
    });
    if (!consumed) throw new ConflictException('原扣减台账缺失，无法自动冲正');
    await tx.lessonHourLedger.create({
      data: {
        studentId: current.studentId,
        classId: current.session.classId,
        sessionId: current.sessionId,
        attendanceId: current.id,
        type: LessonHourLedgerType.REVERSAL,
        amount: consumed.amount.negated(),
        reversalOfId: consumed.id,
        idempotencyKey: `attendance:${current.id}:v${nextVersion}:reversal`,
        note: `冲正原考勤扣减：${reason.trim()}`,
        createdBy: actorId,
      },
    });
  }

  private async assertMembers(tx: Prisma.TransactionClient, classId: string, studentIds: string[]) {
    const count = await tx.classStudent.count({
      where: { classId, studentId: { in: studentIds }, status: ClassMemberStatus.ACTIVE },
    });
    if (count !== studentIds.length) throw new BadRequestException('存在不属于该班级的学生');
  }

  private normalizeDeduct(
    status: AttendanceStatus,
    requested: number | undefined,
    sessionHours: Prisma.Decimal,
    countInStatistics: boolean,
  ) {
    if (!countInStatistics || !BILLABLE_STATUSES.has(status)) return 0;
    return requested ?? Number(sessionHours);
  }

  private correctedDeduct(status: AttendanceStatus, requested: number, countInStatistics: boolean) {
    const amount = new Prisma.Decimal(requested);
    if ((!countInStatistics || !BILLABLE_STATUSES.has(status)) && !amount.isZero()) {
      throw new BadRequestException('当前考勤状态不计课时，扣减课时必须为 0');
    }
    return amount;
  }

  private consumeKey(attendanceId: string, version: number) {
    return `attendance:${attendanceId}:v${version}:consume`;
  }

  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') continue;
        throw error;
      }
    }
    throw new ConflictException('并发操作冲突，请重试');
  }
}
