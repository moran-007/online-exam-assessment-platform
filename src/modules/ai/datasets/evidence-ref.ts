export type EvidenceValue = string | number | boolean | null;

export type EvidenceSourceType =
  | 'exam'
  | 'exam_attempt'
  | 'answer_record'
  | 'question'
  | 'knowledge_point'
  | 'wrong_question'
  | 'class'
  | 'student';

export type EvidenceRef = {
  refId: string;
  sourceType: EvidenceSourceType;
  sourceId: string;
  metric: string;
  path: string;
  value: EvidenceValue;
  unit?: string;
  capturedAt: string;
};

export type EvidenceIndex = Record<string, EvidenceRef>;

export type EvidencedValue<T extends EvidenceValue> = {
  value: T;
  evidenceRef: string;
};

export function assertEvidenceIndex(index: EvidenceIndex) {
  for (const [key, evidence] of Object.entries(index)) {
    if (key !== evidence.refId) throw new Error(`Evidence index key does not match refId: ${key}`);
    if (!evidence.sourceId || !evidence.metric || !evidence.path) {
      throw new Error(`Evidence reference is incomplete: ${key}`);
    }
    if (!Number.isFinite(Date.parse(evidence.capturedAt))) {
      throw new Error(`Evidence capturedAt is invalid: ${key}`);
    }
  }
}
