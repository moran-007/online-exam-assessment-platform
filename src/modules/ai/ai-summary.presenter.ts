import type { AiSummary, Prisma } from '@prisma/client';
import type { EvidenceIndex } from './datasets/evidence-ref';

export function evidenceIndex(value: Prisma.JsonValue) {
  return value as unknown as EvidenceIndex;
}

export function evidenceList(value: Prisma.JsonValue) {
  return Object.values(evidenceIndex(value))
    .sort((left, right) => left.refId.localeCompare(right.refId))
    .map((item) => ({ ...item, unit: item.unit ?? null }));
}

export function presentSummary(row: AiSummary) {
  return {
    id: row.id,
    type: row.type.toLowerCase(),
    subjectId: row.subjectId,
    reviewStatus: row.reviewStatus.toLowerCase(),
    draftVersion: row.draftVersion,
    content: row.summaryJson,
    evidence: evidenceList(row.evidenceIndexJson),
    reviewedBy: row.reviewedBy,
    publishedAt: row.publishedAt,
    revokedAt: row.revokedAt,
    updatedAt: row.updatedAt,
  };
}
