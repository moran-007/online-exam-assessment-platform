import type {
  EvidencedValue,
  EvidenceIndex,
  EvidenceSourceType,
  EvidenceValue,
} from './evidence-ref';

export class EvidenceCollector {
  readonly index: EvidenceIndex = {};

  constructor(private readonly capturedAt: string) {}

  collect<T extends EvidenceValue>(input: {
    sourceType: EvidenceSourceType;
    sourceId: string;
    metric: string;
    path: string;
    value: T;
    unit?: string;
  }): EvidencedValue<T> {
    const refId = `${input.sourceType}:${input.sourceId}:${input.metric}`;
    const existing = this.index[refId];
    if (existing && (existing.path !== input.path || !Object.is(existing.value, input.value))) {
      throw new Error(`Evidence reference collision: ${refId}`);
    }
    this.index[refId] = {
      refId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      metric: input.metric,
      path: input.path,
      value: input.value,
      unit: input.unit,
      capturedAt: this.capturedAt,
    };
    return { value: input.value, evidenceRef: refId };
  }
}
