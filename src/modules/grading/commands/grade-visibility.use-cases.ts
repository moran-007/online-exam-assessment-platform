import { BadRequestException, Injectable } from '@nestjs/common';
import { AnswerRecordStatus, AttemptStatus, ShowScoreMode } from '@prisma/client';
import { RequestUser } from '../../../common/interfaces/request-user.interface';
import { toApiEnum } from '../../../common/utils/enum-normalizer';
import { AuditService } from '../../audit/audit.service';
import { DataScopeService } from '../../data-scope/data-scope.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PublishGradesDto } from '../dto/grade-visibility.dto';
import { GradingSupportOperations } from '../grading-support.operations';

@Injectable()
export class GradeVisibilityUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    readonly support: GradingSupportOperations,
  ) {}

  async publishGrades(examId: string, dto: PublishGradesDto, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    const mode = this.support.normalizeShowScoreMode(dto.mode ?? 'after_graded');
    if (mode === ShowScoreMode.NEVER) {
      throw new BadRequestException('发布成绩不能使用 never 模式，请使用撤回接口');
    }

    const attempts = await this.prisma.examAttempt.findMany({
      where: {
        examId,
        id: dto.attemptIds?.length ? { in: [...new Set(dto.attemptIds)] } : undefined,
        userId: dto.studentIds?.length ? { in: [...new Set(dto.studentIds)] } : undefined,
        submittedAt: { not: null },
        status: { not: AttemptStatus.CANCELLED },
      },
      include: { answers: true },
    });
    if (!attempts.length) {
      throw new BadRequestException('没有可发布成绩的提交记录');
    }

    const blocked = attempts.filter((attempt) =>
      attempt.answers.some(
        (answer) =>
          answer.status === AnswerRecordStatus.MANUAL_NEEDED ||
          answer.status === AnswerRecordStatus.JUDGE_PENDING,
      ),
    );
    if (blocked.length && !dto.skipPending) {
      throw new BadRequestException({
        message: '仍有试卷存在未批改或未判题答案，不能发布成绩',
        data: {
          pendingAttemptCount: blocked.length,
          attemptIds: blocked.map((attempt) => attempt.id),
        },
      });
    }

    const publishable = attempts.filter((attempt) => !blocked.some((item) => item.id === attempt.id));
    const publishableIds = publishable.map((attempt) => attempt.id);
    await this.prisma.$transaction(async (tx) => {
      if (publishableIds.length) {
        await tx.examAttempt.updateMany({
          where: { id: { in: publishableIds } },
          data: { status: AttemptStatus.GRADED },
        });
      }
      await tx.exam.update({
        where: { id: examId },
        data: { showScoreMode: mode },
      });
    });

    await this.audit.log({
      userId: user.id,
      action: 'grading:publish-grades',
      module: 'grading',
      targetType: 'exam',
      targetId: examId,
      afterData: {
        mode,
        publishableCount: publishableIds.length,
        skippedPendingCount: blocked.length,
      },
    });

    return {
      examId,
      showScoreMode: toApiEnum(mode),
      publishedAttemptCount: publishableIds.length,
      skippedPendingCount: blocked.length,
      skippedAttemptIds: blocked.map((attempt) => attempt.id),
    };
  }


  async withdrawGrades(examId: string, user: RequestUser) {
    await this.dataScope.assertExamAccessible(user, examId);
    await this.prisma.exam.update({
      where: { id: examId },
      data: { showScoreMode: ShowScoreMode.NEVER },
    });
    await this.audit.log({
      userId: user.id,
      action: 'grading:withdraw-grades',
      module: 'grading',
      targetType: 'exam',
      targetId: examId,
      afterData: { showScoreMode: ShowScoreMode.NEVER },
    });

    return {
      examId,
      showScoreMode: toApiEnum(ShowScoreMode.NEVER),
      withdrawn: true,
    };
  }

}
