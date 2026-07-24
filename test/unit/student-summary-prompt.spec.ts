import { buildStudentSummaryUserPrompt } from '../../src/modules/ai/student-summary-prompt';
import { buildClassSummaryUserPrompt, buildParentReportUserPrompt } from '../../src/modules/ai/integrated-summary-prompt';
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
    expect(prompt).toContain('examAttemptHistory 是完整的历次提交记录');
    expect(prompt).not.toContain('"evidenceIndex"');
    expect(prompt).toContain('家庭情况、心理状态、人格、健康、纪律');
  });

  it('adds the selected schema version only when it is absent', () => {
    expect(parseSummaryJson('{"headline":{}}', 'student-summary-output/v1')).toMatchObject({
      schemaVersion: 'student-summary-output/v1',
    });
    expect(parseSummaryJson('{"schemaVersion":"future/v2"}', 'student-summary-output/v1'))
      .toEqual({ schemaVersion: 'future/v2' });
  });

  it('does not send unselected student or class categories to the model', () => {
    const studentPrompt = buildStudentSummaryUserPrompt({
      type: 'student', datasetVersion: 'student-summary/v4', evidenceIndex: {}, generationMode: 'analysis',
      scope: { summaryDomains: ['homework'] },
      coverage: { selectedExamCount: { value: 99 }, homeworkAssignmentCount: { value: 1 } },
      examPerformance: [{ examName: 'EXAM_SECRET' }],
      attendance: { marker: 'ATTENDANCE_SECRET' },
      lessons: [{ sessionId: 's1', title: '作业课次', startsAt: '2026-07-01', homework: { value: 'HOMEWORK_VISIBLE', evidenceRef: 'h1' }, classPerformance: { value: 'CLASS_SECRET' } }],
      scratchWorks: [],
    } as never);
    expect(studentPrompt).toContain('HOMEWORK_VISIBLE');
    expect(studentPrompt).not.toContain('EXAM_SECRET');
    expect(studentPrompt).not.toContain('ATTENDANCE_SECRET');
    expect(studentPrompt).not.toContain('CLASS_SECRET');

    const classPrompt = buildClassSummaryUserPrompt({
      type: 'class', datasetVersion: 'class-summary/v2', evidenceIndex: {},
      scope: { summaryDomains: ['exams'], recentExamCount: 2 },
      coverage: { examCount: { value: 2 }, lessonCount: { value: 9 }, homeworkAssignmentCount: { value: 8 } },
      assessment: { marker: 'EXAMS_VISIBLE' }, attendance: { marker: 'ATTENDANCE_SECRET' },
      lessons: { completedCount: { value: 9 }, homeworkAssignmentCount: { value: 8 } },
    } as never);
    expect(classPrompt).toContain('EXAMS_VISIBLE');
    expect(classPrompt).not.toContain('ATTENDANCE_SECRET');
    expect(classPrompt).not.toContain('homeworkAssignmentCount');

    const parentPrompt = buildParentReportUserPrompt({
      type: 'parent_report', datasetVersion: 'parent-report/v2', evidenceIndex: {},
      scope: { summaryDomains: ['homework'], recentExamCount: null },
      coverage: { visibleExamCount: { value: 3 }, publishedLessonRecordCount: { value: 1 } },
      exams: [{ examName: 'PARENT_EXAM_SECRET' }], attendance: { marker: 'PARENT_ATTENDANCE_SECRET' },
      publishedLessons: [{ sessionId: 's1', title: '课次', startsAt: '2026-07-01', homework: { value: 'PARENT_HOMEWORK_VISIBLE', evidenceRef: 'ph1' }, classPerformance: { value: 'PARENT_CLASS_SECRET' } }],
    } as never);
    expect(parentPrompt).toContain('PARENT_HOMEWORK_VISIBLE');
    expect(parentPrompt).not.toContain('PARENT_EXAM_SECRET');
    expect(parentPrompt).not.toContain('PARENT_ATTENDANCE_SECRET');
    expect(parentPrompt).not.toContain('PARENT_CLASS_SECRET');
  });
});
