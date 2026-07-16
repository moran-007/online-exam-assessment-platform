import { buildStudentSummaryUserPrompt } from '../../src/modules/ai/student-summary-prompt';
import { parseSummaryJson } from '../../src/modules/ai/summary-prompt';

describe('student summary prompt boundary', () => {
  it('requires coverage disclosure and forbids unsupported education inferences', () => {
    const prompt = buildStudentSummaryUserPrompt({
      type: 'student',
      datasetVersion: 'student-summary/v1',
      evidenceIndex: { 'student:one:graded': { refId: 'student:one:graded' } },
    } as never);

    expect(prompt).toContain('schemaVersion="student-summary-output/v1"');
    expect(prompt).toContain('必须说明数据覆盖范围');
    expect(prompt).toContain('not_submitted 与 ungraded 不是零分');
    expect(prompt).toContain('不得把无教育数据解释为缺勤');
    expect(prompt).toContain('家庭情况、心理状态、人格、健康、纪律');
  });

  it('adds the selected schema version only when it is absent', () => {
    expect(parseSummaryJson('{"headline":{}}', 'student-summary-output/v1')).toMatchObject({
      schemaVersion: 'student-summary-output/v1',
    });
    expect(parseSummaryJson('{"schemaVersion":"future/v2"}', 'student-summary-output/v1'))
      .toEqual({ schemaVersion: 'future/v2' });
  });
});
