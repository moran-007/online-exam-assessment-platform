import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AnswerRecordStatus,
  Prisma,
  ScoringEvaluationSource,
  ScoringEvaluationStatus,
} from '@prisma/client';
import { ScoreResult } from './question-type.contract';

type ProjectionInput = {
  answerRecordId: string;
  answerJson: Prisma.JsonValue;
  score: number;
  maxScore: number;
  isCorrect: boolean | null;
  status: AnswerRecordStatus;
  details: Prisma.InputJsonObject;
  adapterKey: string;
  adapterVersion: number;
  source: ScoringEvaluationSource;
  gradedBy?: string | null;
  scoringRuleVersionId?: string | null;
  ruleSnapshot?: Prisma.InputJsonValue | null;
  regradeRunId?: string | null;
};

@Injectable()
export class ScoringHistoryService {
  answerFingerprint(answerRecordId: string, answerJson: Prisma.JsonValue) {
    return createHash('sha256')
      .update(`${answerRecordId}:${this.stableStringify(answerJson)}`)
      .digest('hex');
  }

  runFingerprint(
    records: Array<{ id: string; answerJson: Prisma.JsonValue; score: Prisma.Decimal; updatedAt: Date }>,
  ) {
    const value = records
      .map((record) => ({
        id: record.id,
        answer: record.answerJson,
        score: Number(record.score),
        updatedAt: record.updatedAt.toISOString(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  async recordOfficial(tx: Prisma.TransactionClient, input: ProjectionInput) {
    await tx.scoringEvaluation.updateMany({
      where: {
        answerRecordId: input.answerRecordId,
        status: ScoringEvaluationStatus.OFFICIAL,
      },
      data: { status: ScoringEvaluationStatus.SUPERSEDED },
    });
    const evaluation = await tx.scoringEvaluation.create({
      data: {
        answerRecordId: input.answerRecordId,
        scoringRuleVersionId: input.scoringRuleVersionId ?? null,
        regradeRunId: input.regradeRunId ?? null,
        source: input.source,
        status: ScoringEvaluationStatus.OFFICIAL,
        adapterKey: input.adapterKey,
        adapterVersion: input.adapterVersion,
        score: input.score,
        maxScore: input.maxScore,
        isCorrect: input.isCorrect,
        detailJson: input.details,
        ruleSnapshotJson: input.ruleSnapshot ?? Prisma.JsonNull,
        answerFingerprint: this.answerFingerprint(input.answerRecordId, input.answerJson),
        gradedBy: input.gradedBy ?? null,
      },
    });
    await tx.answerRecord.update({
      where: { id: input.answerRecordId },
      data: { currentEvaluationId: evaluation.id },
    });
    return evaluation;
  }

  fromScoreResult(
    answerRecordId: string,
    answerJson: Prisma.JsonValue,
    result: ScoreResult,
    source: ScoringEvaluationSource,
    extra: Partial<Omit<ProjectionInput, 'answerRecordId' | 'answerJson' | 'score' | 'maxScore' | 'isCorrect' | 'status' | 'details' | 'adapterKey' | 'adapterVersion' | 'source'>> = {},
  ): ProjectionInput {
    return {
      answerRecordId,
      answerJson,
      score: result.score,
      maxScore: result.maxScore,
      isCorrect: result.isCorrect,
      status: result.status,
      details: result.details,
      adapterKey: result.engine.adapterKey,
      adapterVersion: result.engine.adapterVersion,
      source,
      ...extra,
    };
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
  }
}
