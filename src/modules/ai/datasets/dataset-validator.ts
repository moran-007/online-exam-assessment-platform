import { assertEvidenceIndex, type EvidenceIndex, type EvidenceValue } from './evidence-ref';
import type { SummaryDatasetBase } from './summary-dataset';

export function assertSummaryDataset<T extends SummaryDatasetBase>(dataset: T) {
  assertEvidenceIndex(dataset.evidenceIndex);
  let referencedValues = 0;
  visit(dataset, dataset.evidenceIndex, () => { referencedValues += 1; });
  if (!referencedValues) throw new Error('Summary dataset does not contain evidenced values.');
}

function visit(value: unknown, evidenceIndex: EvidenceIndex, onReference: () => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, evidenceIndex, onReference));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (typeof record.evidenceRef === 'string' && 'value' in record) {
    const evidence = evidenceIndex[record.evidenceRef];
    if (!evidence) throw new Error(`Dataset references unknown evidence: ${record.evidenceRef}`);
    if (!sameValue(record.value as EvidenceValue, evidence.value)) {
      throw new Error(`Dataset value does not match evidence: ${record.evidenceRef}`);
    }
    onReference();
  }
  Object.values(record).forEach((item) => visit(item, evidenceIndex, onReference));
}

function sameValue(left: EvidenceValue, right: EvidenceValue) {
  return Object.is(left, right);
}
