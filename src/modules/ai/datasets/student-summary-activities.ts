import { AttemptStatus, LessonRecordStatus } from '@prisma/client';
import { ratio } from '../../statistics/statistics-math';
import { EvidenceCollector } from './evidence-collector';
import type {
  StudentAttempt,
  StudentExam,
  StudentLesson,
  StudentScratchWork,
} from './student-summary-data';
import type { StudentSummaryDataset } from './summary-dataset';

export function collectStudentValue(
  evidence: EvidenceCollector,
  studentId: string,
  metric: string,
  value: number,
  unit: string,
) {
  return evidence.collect({
    sourceType: 'student', sourceId: studentId, metric,
    path: `/students/${studentId}/summary/${metric}`, value, unit,
  });
}

export function collectKnowledgeValue(
  evidence: EvidenceCollector,
  knowledgePointId: string,
  metric: string,
  value: number,
  unit: string,
) {
  return evidence.collect({
    sourceType: 'knowledge_point', sourceId: knowledgePointId, metric,
    path: `/students/summary/knowledge-points/${knowledgePointId}/${metric}`, value, unit,
  });
}

export function buildScratchActivity(
  evidence: EvidenceCollector,
  studentId: string,
  work: StudentScratchWork,
): StudentSummaryDataset['scratchWorks'][number] {
  const review = work.reviews[0];
  const judge = work.judgeRuns[0];
  return {
    workId: work.id,
    assignmentTitle: work.assignment.title,
    sessionId: work.assignment.sessionId,
    status: evidence.collect({
      sourceType: 'scratch_work', sourceId: work.id, metric: 'status',
      path: `/students/${studentId}/scratch-works/${work.id}/status`,
      value: work.status.toLowerCase(), unit: 'status',
    }),
    versionCount: evidence.collect({
      sourceType: 'scratch_work', sourceId: work.id, metric: 'versionCount',
      path: `/students/${studentId}/scratch-works/${work.id}/versionCount`,
      value: work.currentVersion, unit: 'version',
    }),
    submittedAt: work.submittedAt?.toISOString() ?? null,
    latestReviewScore: evidence.collect({
      sourceType: review ? 'scratch_review' : 'scratch_work', sourceId: review?.id ?? work.id,
      metric: 'latestReviewScore', path: `/students/${studentId}/scratch-works/${work.id}/latestReviewScore`,
      value: review?.score === null || review?.score === undefined ? null : Number(review.score), unit: 'score',
    }),
    latestReviewComment: evidence.collect({
      sourceType: review ? 'scratch_review' : 'scratch_work', sourceId: review?.id ?? work.id,
      metric: 'latestReviewComment', path: `/students/${studentId}/scratch-works/${work.id}/latestReviewComment`,
      value: review?.comment ?? null, unit: 'text',
    }),
    latestJudgeStatus: evidence.collect({
      sourceType: judge ? 'scratch_judge_run' : 'scratch_work', sourceId: judge?.id ?? work.id,
      metric: 'latestJudgeStatus', path: `/students/${studentId}/scratch-works/${work.id}/latestJudgeStatus`,
      value: judge?.status.toLowerCase() ?? null, unit: 'status',
    }),
    latestJudgeScore: evidence.collect({
      sourceType: judge ? 'scratch_judge_run' : 'scratch_work', sourceId: judge?.id ?? work.id,
      metric: 'latestJudgeScore', path: `/students/${studentId}/scratch-works/${work.id}/latestJudgeScore`,
      value: judge?.score === null || judge?.score === undefined ? null : Number(judge.score), unit: 'score',
    }),
  };
}

export function buildLessonActivity(
  evidence: EvidenceCollector,
  studentId: string,
  lesson: StudentLesson,
): StudentSummaryDataset['lessons'][number] {
  const attendance = lesson.attendance[0];
  const record = lesson.lessonRecord?.status === LessonRecordStatus.PUBLISHED
    ? lesson.lessonRecord
    : null;
  return {
    sessionId: lesson.id,
    title: lesson.title,
    startsAt: lesson.startsAt.toISOString(),
    status: evidence.collect({
      sourceType: 'lesson_session', sourceId: lesson.id, metric: 'status',
      path: `/students/${studentId}/lessons/${lesson.id}/status`,
      value: lesson.status.toLowerCase(), unit: 'status',
    }),
    lessonHours: evidence.collect({
      sourceType: 'lesson_session', sourceId: lesson.id, metric: 'lessonHours',
      path: `/students/${studentId}/lessons/${lesson.id}/lessonHours`,
      value: Number(lesson.lessonHours), unit: 'hour',
    }),
    attendanceStatus: evidence.collect({
      sourceType: attendance ? 'attendance' : 'lesson_session',
      sourceId: attendance?.id ?? lesson.id,
      metric: 'attendanceStatus',
      path: `/students/${studentId}/lessons/${lesson.id}/attendanceStatus`,
      value: attendance?.status.toLowerCase() ?? null,
      unit: 'status',
    }),
    learningGoal: collectLessonRecordValue(
      evidence, studentId, lesson.id, record?.id, 'learningGoal', record?.publicLearningGoal ?? null,
    ),
    classPerformance: collectLessonRecordValue(
      evidence, studentId, lesson.id, record?.id, 'classPerformance', record?.publicClassPerformance ?? null,
    ),
    homework: collectLessonRecordValue(
      evidence, studentId, lesson.id, record?.id, 'homework', record?.publicHomework ?? null,
    ),
  };
}

export function buildExamPerformance(
  evidence: EvidenceCollector,
  studentId: string,
  exam: StudentExam,
  attempt?: StudentAttempt,
): StudentSummaryDataset['examPerformance'][number] {
  const graded = attempt?.status === AttemptStatus.GRADED;
  const status = !attempt ? 'not_submitted' : graded ? 'graded' : 'ungraded';
  const score = graded ? Number(attempt.totalScore) : null;
  const fullScore = Number(exam.paper.totalScore);
  const statusSource = attempt
    ? { sourceType: 'exam_attempt' as const, sourceId: attempt.id }
    : { sourceType: 'exam' as const, sourceId: exam.id };
  return {
    examId: exam.id,
    examName: exam.name,
    endedAt: exam.endTime.toISOString(),
    status: evidence.collect({
      ...statusSource, metric: `student.${studentId}.status`,
      path: `/students/${studentId}/exams/${exam.id}/status`, value: status, unit: 'status',
    }),
    submittedAt: attempt?.submittedAt?.toISOString() ?? null,
    score: evidence.collect({
      ...statusSource, metric: `student.${studentId}.score`,
      path: `/students/${studentId}/exams/${exam.id}/score`, value: score, unit: 'score',
    }),
    fullScore: evidence.collect({
      sourceType: 'exam', sourceId: exam.id, metric: 'fullScore',
      path: `/students/${studentId}/exams/${exam.id}/fullScore`, value: fullScore, unit: 'score',
    }),
    scoreRate: evidence.collect({
      ...statusSource, metric: `student.${studentId}.scoreRate`,
      path: `/students/${studentId}/exams/${exam.id}/scoreRate`,
      value: score === null ? null : ratio(score, fullScore), unit: 'ratio',
    }),
  };
}

function collectLessonRecordValue(
  evidence: EvidenceCollector,
  studentId: string,
  sessionId: string,
  recordId: string | undefined,
  metric: string,
  value: string | null,
) {
  return evidence.collect({
    sourceType: recordId ? 'lesson_record' : 'lesson_session',
    sourceId: recordId ?? sessionId,
    metric,
    path: `/students/${studentId}/lessons/${sessionId}/${metric}`,
    value,
    unit: 'text',
  });
}
