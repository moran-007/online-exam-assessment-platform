import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { QuestionTypeRegistry } from '../question-types/question-type-registry.service';
import { AssetTokenService } from '../uploads/asset-token.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuestionsContext {
  constructor(
    public readonly prisma: PrismaService,
    public readonly audit: AuditService,
    public readonly assetTokens: AssetTokenService,
    public readonly questionTypes: QuestionTypeRegistry,
  ) {}
}
