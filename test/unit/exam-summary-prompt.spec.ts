import {
  buildExamSummaryUserPrompt,
  ExamSummaryParseError,
  parseSummaryJson,
} from '../../src/modules/ai/exam-summary-prompt';

describe('exam summary prompt boundary', () => {
  it('provides the exact compact JSON shape and evidence constraints', () => {
    const prompt = buildExamSummaryUserPrompt({
      type: 'exam',
      datasetVersion: 'exam-summary/v1',
      evidenceIndex: { 'exam:one:average': { refId: 'exam:one:average' } },
    } as never);
    expect(prompt).toContain('schemaVersion="exam-summary-output/v1"');
    expect(prompt).toContain('"headline"');
    expect(prompt).toContain('evidenceIndex 中真实存在的 refId');
    expect(prompt).toContain('actions 不超过 3 条');
  });

  it('adds only the known transport schema version when a valid JSON object omitted it', () => {
    expect(parseSummaryJson('{"headline":{},"overview":[]}')).toMatchObject({
      schemaVersion: 'exam-summary-output/v1',
      headline: {},
    });
  });

  it('preserves an explicit version for the strict validator and rejects invalid JSON', () => {
    expect(parseSummaryJson('{"schemaVersion":"future/v2"}')).toEqual({ schemaVersion: 'future/v2' });
    expect(() => parseSummaryJson('not-json')).toThrow(ExamSummaryParseError);
  });
});
