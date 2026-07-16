import { Injectable, NotFoundException } from '@nestjs/common';
import { AiSummaryType } from '@prisma/client';
import { RequestUser } from '../../common/interfaces/request-user.interface';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';

const SUPPORTED_TYPES: AiSummaryType[] = [AiSummaryType.EXAM, AiSummaryType.STUDENT];

@Injectable()
export class AiSummaryAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  async require(id: string, user: RequestUser) {
    const summary = await this.prisma.aiSummary.findUnique({
      where: { id },
      include: { task: { select: { scopeJson: true } } },
    });
    if (!summary || !SUPPORTED_TYPES.includes(summary.type)) {
      throw new NotFoundException('AI 总结不存在');
    }
    await this.assertSubject(summary.type, summary.subjectId, user);
    return summary;
  }

  async assertSubject(type: AiSummaryType, subjectId: string, user: RequestUser) {
    if (type === AiSummaryType.EXAM) {
      await this.dataScope.assertExamAccessible(user, subjectId);
      return;
    }
    if (type === AiSummaryType.STUDENT) {
      await this.dataScope.assertStudentSummaryAccessible(user, subjectId);
      return;
    }
    throw new NotFoundException('AI 总结类型暂不支持');
  }

  find(id: string) {
    return this.prisma.aiSummary.findUniqueOrThrow({
      where: { id },
      include: { task: { select: { scopeJson: true } } },
    });
  }
}
