import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { UpdatePaperQuestionSnapshotDto } from '../dto/update-paper-question-snapshot.dto';
import { PaperSnapshotAssembler } from '../paper-snapshot.assembler';
import { PaperSupportOperations } from '../paper-support.operations';

@Injectable()
export class PaperSnapshotUseCase {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly support: PaperSupportOperations,
    readonly snapshots: PaperSnapshotAssembler,
  ) {}

  async updateQuestionSnapshot(
      id: string,
      paperQuestionId: string,
      dto: UpdatePaperQuestionSnapshotDto,
      userId: string,
    ) {
      await this.support.findSnapshotEditable(id);

      const exists = await this.prisma.paperQuestion.findFirst({
        where: { id: paperQuestionId, paperId: id },
      });

      if (!exists) {
        throw new NotFoundException('试卷题目不存在');
      }

      const beforeSnapshot = this.snapshots.toSnapshotObject(exists.questionSnapshotJson);
      const nextSnapshot = this.snapshots.mergeQuestionSnapshot(beforeSnapshot, dto);

      await this.prisma.paperQuestion.update({
        where: { id: paperQuestionId },
        data: {
          questionSnapshotJson: nextSnapshot as Prisma.InputJsonObject,
        },
      });

      await this.audit.log({
        userId,
        action: 'paper:update-question-snapshot',
        module: 'paper',
        targetType: 'paper',
        targetId: id,
        beforeData: {
          paperQuestionId,
          title: String(beforeSnapshot.title ?? ''),
        },
        afterData: {
          paperQuestionId,
          title: String(nextSnapshot.title ?? ''),
        },
      });

      return { id: paperQuestionId };
    }
}
