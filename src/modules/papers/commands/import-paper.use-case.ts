import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaperStatus, PaperType, Prisma } from '@prisma/client';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionSnapshotUseCases, QuestionWriteUseCases } from '../../questions/questions.use-cases';
import { ImportPaperDto } from '../dto/import-paper.dto';
import { PaperImportNormalizer } from '../paper-import.normalizer';
import { PaperSupportOperations } from '../paper-support.operations';

@Injectable()
export class ImportPaperUseCase {
  constructor(
    readonly prisma: PrismaService,
    readonly questionWrites: QuestionWriteUseCases,
    readonly questionSnapshots: QuestionSnapshotUseCases,
    readonly audit: AuditService,
    readonly normalizer: PaperImportNormalizer,
    readonly support: PaperSupportOperations,
  ) {}

  async importPaper(dto: ImportPaperDto, userId: string) {
      if (!dto.questions?.length) {
        throw new BadRequestException('导入试卷至少需要包含一道题');
      }

      const normalizedRecords = dto.questions.map((record) => this.normalizer.normalizeImportedQuestionRecord(record));
      const importedCourseId = normalizedRecords.find((record) => typeof record.courseId === 'string')?.courseId;
      const courseId = dto.courseId || (typeof importedCourseId === 'string' ? importedCourseId : '');
      if (!courseId) {
        throw new BadRequestException('请选择导入试卷所属课程');
      }

      const course = await this.prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
      if (!course) {
        throw new NotFoundException('导入试卷所属课程不存在');
      }

      const resolvedQuestions: Array<{
        questionId: string;
        snapshot: Prisma.InputJsonObject;
        score: number;
        sectionTitle: string | null;
        sortOrder: number;
      }> = [];
      let reusedCount = 0;
      let createdQuestionCount = 0;

      for (const [index, record] of normalizedRecords.entries()) {
        const payload = await this.normalizer.toImportedQuestionCreateDto(record, courseId);
        let questionId = dto.reuseExisting === false ? '' : await this.normalizer.findDuplicateQuestionId(payload);
        if (questionId && !(await this.normalizer.canReuseImportedQuestion(questionId, payload))) {
          questionId = '';
        }

        if (questionId) {
          reusedCount += 1;
        } else {
          const created = await this.questionWrites.create(payload, userId);
          questionId = created.id;
          createdQuestionCount += 1;
        }

        const snapshot = await this.questionSnapshots.buildSnapshot(this.prisma, questionId);
        resolvedQuestions.push({
          questionId,
          snapshot,
          score: Number(record.score ?? payload.defaultScore) || Number(payload.defaultScore) || 0,
          sectionTitle: String(record.sectionTitle || record.section || '').trim() || null,
          sortOrder: Number(record.sortOrder ?? record.no ?? index + 1) || index + 1,
        });
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const paper = await tx.paper.create({
          data: {
            name: this.normalizer.importedPaperName(dto.name || normalizedRecords[0]?.paperName),
            courseId,
            durationMinutes: dto.durationMinutes ?? 60,
            type: PaperType.FIXED,
            status: PaperStatus.DRAFT,
            shuffleQuestions: dto.shuffleQuestions ?? false,
            shuffleOptions: dto.shuffleOptions ?? false,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        const sectionMap = new Map<string, string>();

        for (const item of resolvedQuestions) {
          const sectionId = item.sectionTitle
            ? await this.normalizer.resolveImportedSection(tx, paper.id, item.sectionTitle, sectionMap)
            : null;
          await tx.paperQuestion.create({
            data: {
              paperId: paper.id,
              sectionId,
              questionId: item.questionId,
              questionSnapshotJson: item.snapshot,
              score: item.score,
              sortOrder: item.sortOrder,
            },
          });
        }

        await this.support.normalizeSortOrders(tx, paper.id);
        const totalScore = await this.support.recalculateScore(tx, paper.id);
        return { paperId: paper.id, questionCount: resolvedQuestions.length, totalScore };
      });

      await this.audit.log({
        userId,
        action: 'paper:import',
        module: 'paper',
        targetType: 'paper',
        targetId: result.paperId,
        afterData: {
          questionCount: result.questionCount,
          reusedCount,
          createdQuestionCount,
        },
      });

      return {
        ...result,
        reusedCount,
        createdQuestionCount,
      };
    }
}
