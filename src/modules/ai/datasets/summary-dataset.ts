import type { EvidenceIndex, EvidencedValue } from './evidence-ref';

export type DatasetCoverage = {
  from: string | null;
  to: string | null;
  includes: string[];
  excludes: string[];
};

export type SummaryDatasetBase = {
  datasetVersion: string;
  generatedAt: string;
  dataCoverage: DatasetCoverage;
  evidenceIndex: EvidenceIndex;
};

export type ExamSummaryDataset = SummaryDatasetBase & {
  type: 'exam';
  exam: {
    id: string;
    name: string;
    courseId: string;
    courseName: string;
    classId: string | null;
    className: string | null;
  };
  participation: {
    eligible: EvidencedValue<number | null>;
    submitted: EvidencedValue<number>;
    graded: EvidencedValue<number>;
    submissionRate: EvidencedValue<number | null>;
  };
  scores: {
    fullScore: EvidencedValue<number>;
    average: EvidencedValue<number>;
    median: EvidencedValue<number>;
    minimum: EvidencedValue<number>;
    maximum: EvidencedValue<number>;
  };
  distribution: Array<{
    label: string;
    count: EvidencedValue<number>;
    rate: EvidencedValue<number>;
  }>;
  questions: Array<{
    questionId: string;
    title: string;
    answerCount: EvidencedValue<number>;
    correctRate: EvidencedValue<number>;
    averageScore: EvidencedValue<number>;
    discrimination: EvidencedValue<number>;
    anomalyCount: EvidencedValue<number>;
  }>;
  knowledgePoints: Array<{
    knowledgePointId: string;
    name: string;
    answerCount: EvidencedValue<number>;
    correctRate: EvidencedValue<number>;
  }>;
};

export type StudentSummaryDataset = SummaryDatasetBase & {
  type: 'student';
  generationMode: 'analysis' | 'fact_card';
  student: {
    id: string;
    alias: string;
  };
  scope: {
    courseId: string | null;
    courseName: string | null;
    examIds: string[];
  };
  coverage: {
    selectedExamCount: EvidencedValue<number>;
    gradedExamCount: EvidencedValue<number>;
    notSubmittedExamCount: EvidencedValue<number>;
    ungradedExamCount: EvidencedValue<number>;
    gradedAnswerCount: EvidencedValue<number>;
    scheduledLessonCount: EvidencedValue<number>;
    completedLessonCount: EvidencedValue<number>;
    attendanceRecordCount: EvidencedValue<number>;
    publishedLessonRecordCount: EvidencedValue<number>;
    homeworkAssignmentCount: EvidencedValue<number>;
  };
  examPerformance: Array<{
    examId: string;
    examName: string;
    endedAt: string;
    status: EvidencedValue<'graded' | 'not_submitted' | 'ungraded'>;
    submittedAt: string | null;
    score: EvidencedValue<number | null>;
    fullScore: EvidencedValue<number>;
    scoreRate: EvidencedValue<number | null>;
  }>;
  questionTypes: Array<{
    type: string;
    answerCount: EvidencedValue<number>;
    correctRate: EvidencedValue<number>;
    scoreRate: EvidencedValue<number>;
  }>;
  knowledgePoints: Array<{
    knowledgePointId: string;
    name: string;
    answerCount: EvidencedValue<number>;
    correctRate: EvidencedValue<number>;
    scoreRate: EvidencedValue<number>;
  }>;
  wrongQuestions: Array<{
    questionId: string;
    title: string;
    questionType: string;
    wrongCount: EvidencedValue<number>;
    masteryStatus: EvidencedValue<string>;
  }>;
  programming: {
    submissionCount: EvidencedValue<number>;
    acceptedCount: EvidencedValue<number>;
    acceptedRate: EvidencedValue<number>;
    averageScore: EvidencedValue<number>;
  };
  attendance: {
    confirmedCount: EvidencedValue<number>;
    presentCount: EvidencedValue<number>;
    lateCount: EvidencedValue<number>;
    leaveCount: EvidencedValue<number>;
    absentCount: EvidencedValue<number>;
    attendanceRate: EvidencedValue<number>;
  };
  lessons: Array<{
    sessionId: string;
    title: string;
    startsAt: string;
    status: EvidencedValue<string>;
    lessonHours: EvidencedValue<number>;
    attendanceStatus: EvidencedValue<string | null>;
    learningGoal: EvidencedValue<string | null>;
    classPerformance: EvidencedValue<string | null>;
    homework: EvidencedValue<string | null>;
  }>;
};

export type ClassSummaryDataset = SummaryDatasetBase & {
  type: 'class';
  class: { id: string; alias: string; courseName: string };
  coverage: {
    studentCount: EvidencedValue<number>;
    examCount: EvidencedValue<number>;
    gradedAttemptCount: EvidencedValue<number>;
    lessonCount: EvidencedValue<number>;
    publishedLessonRecordCount: EvidencedValue<number>;
    homeworkAssignmentCount: EvidencedValue<number>;
  };
  assessment: {
    averageScore: EvidencedValue<number>;
    knowledgePoints: Array<{
      knowledgePointId: string;
      name: string;
      answerCount: EvidencedValue<number>;
      correctRate: EvidencedValue<number>;
      scoreRate: EvidencedValue<number>;
    }>;
  };
  attendance: {
    confirmedCount: EvidencedValue<number>;
    presentCount: EvidencedValue<number>;
    lateCount: EvidencedValue<number>;
    leaveCount: EvidencedValue<number>;
    absentCount: EvidencedValue<number>;
    attendanceRate: EvidencedValue<number>;
  };
  lessons: {
    completedCount: EvidencedValue<number>;
    completedHours: EvidencedValue<number>;
    publishedRecordCount: EvidencedValue<number>;
    homeworkAssignmentCount: EvidencedValue<number>;
  };
};

export type ParentReportDataset = SummaryDatasetBase & {
  type: 'parent_report';
  student: { id: string; alias: string };
  coverage: {
    visibleExamCount: EvidencedValue<number>;
    publishedLessonRecordCount: EvidencedValue<number>;
    confirmedAttendanceCount: EvidencedValue<number>;
  };
  exams: Array<{
    examId: string;
    examName: string;
    submittedAt: string;
    score: EvidencedValue<number | null>;
    scoreVisible: EvidencedValue<boolean>;
  }>;
  attendance: {
    presentCount: EvidencedValue<number>;
    lateCount: EvidencedValue<number>;
    leaveCount: EvidencedValue<number>;
    absentCount: EvidencedValue<number>;
  };
  publishedLessons: Array<{
    sessionId: string;
    title: string;
    startsAt: string;
    learningGoal: EvidencedValue<string | null>;
    classPerformance: EvidencedValue<string | null>;
    homework: EvidencedValue<string | null>;
    nextPlan: EvidencedValue<string | null>;
  }>;
};

export type LessonAssistantDataset = SummaryDatasetBase & {
  type: 'lesson';
  session: {
    id: string;
    title: string;
    startsAt: string;
    classAlias: string;
  };
  currentRecord: {
    status: EvidencedValue<string>;
    teachingContent: EvidencedValue<string | null>;
    learningGoal: EvidencedValue<string | null>;
    classPerformance: EvidencedValue<string | null>;
    homework: EvidencedValue<string | null>;
    nextPlan: EvidencedValue<string | null>;
    internalTeachingNotes: EvidencedValue<string | null>;
    internalClassPerformance: EvidencedValue<string | null>;
  };
};

export type SupportedSummaryDataset =
  | ExamSummaryDataset
  | StudentSummaryDataset
  | ClassSummaryDataset
  | ParentReportDataset
  | LessonAssistantDataset;
