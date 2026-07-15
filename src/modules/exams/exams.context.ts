import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DataScopeService } from '../data-scope/data-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { ScoringHistoryService } from '../question-types/scoring-history.service';

@Injectable()
export class ExamsContext {
  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly dataScope: DataScopeService,
    readonly questionTypes: QuestionTypeRegistry,
    readonly scoringHistory: ScoringHistoryService,
  ) {}
}
