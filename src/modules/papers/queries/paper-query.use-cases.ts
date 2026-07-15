import { Injectable, NotFoundException } from '@nestjs/common';
import { ExamStatus, Prisma } from '@prisma/client';
import { toPagination } from '../../../common/dto/pagination-query.dto';
import { normalizePaperStatus, toApiEnum } from '../../../common/utils/enum-normalizer';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperSupportOperations } from '../paper-support.operations';
import { QueryPaperDto } from '../dto/query-paper.dto';

@Injectable()
export class PaperQueryUseCases {
  constructor(
    readonly prisma: PrismaService,
    readonly support: PaperSupportOperations,
  ) {}

  async list(query: QueryPaperDto) {
      const { page, pageSize, skip, take } = toPagination(query);
      const now = new Date();
      const scopeWhere = this.support.paperScopeWhere(query.scope, now);
      const where: Prisma.PaperWhereInput = {
        deletedAt: null,
        courseId: query.courseId,
        status: query.status ? normalizePaperStatus(query.status) : undefined,
        AND: [scopeWhere],
        OR: query.keyword ? [{ name: { contains: query.keyword, mode: 'insensitive' } }] : undefined,
      };

      const [items, total] = await this.prisma.$transaction([
        this.prisma.paper.findMany({
          where,
          include: {
            course: { select: { name: true } },
            _count: {
              select: {
                questions: true,
                exams: {
                  where: {
                    deletedAt: null,
                    status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                    startTime: { lte: now },
                    endTime: { gt: now },
                  },
                },
              },
            },
          },
          orderBy: this.support.paperOrderBy(query),
          skip,
          take,
        }),
        this.prisma.paper.count({ where }),
      ]);

      return {
        items: items.map((paper) => ({
          ...paper,
          type: toApiEnum(paper.type),
          status: toApiEnum(paper.status),
          totalScore: Number(paper.totalScore),
          courseName: paper.course.name,
          questionCount: paper._count.questions,
          examUsageCount: paper._count.exams,
          examOccupied: paper._count.exams > 0,
        })),
        page,
        pageSize,
        total,
      };
    }

  async detail(id: string) {
      const now = new Date();
      const paper = await this.prisma.paper.findFirst({
        where: { id, deletedAt: null },
        include: {
          course: true,
          sections: {
            orderBy: { sortOrder: 'asc' },
            include: {
              questions: { orderBy: { sortOrder: 'asc' } },
            },
          },
          questions: {
            where: { sectionId: null },
            orderBy: { sortOrder: 'asc' },
          },
          rules: true,
          _count: {
            select: {
              exams: {
                where: {
                  deletedAt: null,
                  status: { in: [ExamStatus.SCHEDULED, ExamStatus.RUNNING] },
                  startTime: { lte: now },
                  endTime: { gt: now },
                },
              },
            },
          },
        },
      });

      if (!paper) {
        throw new NotFoundException('试卷不存在');
      }

      const snapshotSafety = await this.support.getSnapshotEditSafety(id);
      return {
        ...this.support.formatPaper(paper),
        canEditSnapshots: snapshotSafety.canEdit,
        snapshotEditReason: snapshotSafety.reason,
      };
    }

  async preview(id: string) {
      return this.detail(id);
    }
}
