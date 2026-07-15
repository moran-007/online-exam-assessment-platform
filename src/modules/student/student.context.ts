import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { ScoringHistoryService } from '../question-types/scoring-history.service';
import { QuestionSnapshotUseCases } from '../questions/questions.use-cases';

@Injectable()
export class StudentContext {
  readonly endedAttemptSaveGraceMs = 2 * 60_000;

  constructor(
    readonly prisma: PrismaService,
    readonly audit: AuditService,
    readonly questionSnapshots: QuestionSnapshotUseCases,
    readonly questionTypes: QuestionTypeRegistry,
    readonly scoringHistory: ScoringHistoryService,
  ) {}
}
