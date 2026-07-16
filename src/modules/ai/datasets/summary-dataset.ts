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
    classId: string | null;
  };
  participation: {
    submitted: EvidencedValue<number>;
    graded: EvidencedValue<number>;
  };
  scores: {
    fullScore: EvidencedValue<number>;
    average: EvidencedValue<number>;
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
  studentId: string;
  courseId: string | null;
  examIds: string[];
  examPerformance: Array<{
    examId: string;
    submittedAt: string;
    score: EvidencedValue<number>;
    scoreRate: EvidencedValue<number>;
  }>;
  knowledgePoints: Array<{
    knowledgePointId: string;
    name: string;
    answerCount: EvidencedValue<number>;
    correctRate: EvidencedValue<number>;
  }>;
  wrongQuestions: Array<{
    questionId: string;
    wrongCount: EvidencedValue<number>;
    masteryStatus: EvidencedValue<string>;
  }>;
  programming: {
    submissionCount: EvidencedValue<number>;
    acceptedCount: EvidencedValue<number>;
  };
};
