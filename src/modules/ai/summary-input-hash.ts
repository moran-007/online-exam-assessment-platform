import { createHash } from 'node:crypto';
import type { SummaryDatasetBase } from './datasets/summary-dataset';

export function createSummaryInputHash(input: unknown) {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

export function createSummaryDatasetInputHash(dataset: SummaryDatasetBase) {
  const evidenceIndex = Object.fromEntries(Object.entries(dataset.evidenceIndex).map(([key, evidence]) => [
    key,
    { ...evidence, capturedAt: undefined },
  ]));
  return createSummaryInputHash({ ...dataset, generatedAt: undefined, evidenceIndex });
}

export function canonicalJson(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonicalJson).join(',')}]`;
  if (input && typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonicalJson(value)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(input);
  if (encoded === undefined) throw new TypeError('Summary input contains an unsupported value.');
  return encoded;
}
