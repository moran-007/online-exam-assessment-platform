import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExamSummaryAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async require(id: string, user: RequestUser) {
    const summary = await this.prisma.aiSummary.findUnique({ where: { id } });
    if (!summary || summary.type !== AiSummaryType.EXAM) throw new NotFoundException('AI 总结不存在');
    await this.dataScope.assertExamAccessible(user, summary.subjectId);
    return summary;
  }

  find(id: string) {
    return this.prisma.aiSummary.findUniqueOrThrow({ where: { id } });
  }
}
