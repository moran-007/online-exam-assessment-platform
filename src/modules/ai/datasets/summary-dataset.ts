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
};
