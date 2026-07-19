import { Prisma } from '@prisma/client';
import type { StudentAnswerFact } from './student-summary-aggregates';

export const MAX_SELECTED_EXAMS = 20;

export const STUDENT_EXAM_SELECT = {
  id: true,
  name: true,
  courseId: true,
  endTime: true,
  course: { select: { name: true } },
  paper: { select: { totalScore: true } },
} satisfies Prisma.ExamSelect;

export const STUDENT_ATTEMPT_SELECT = {
  id: true,
  examId: true,
  status: true,
  submittedAt: true,
  totalScore: true,
  answers: {
    select: {
      id: true,
      score: true,
      isCorrect: true,
      currentEvaluation: { select: { maxScore: true } },
      question: {
        select: {
          id: true,
          type: true,
          defaultScore: true,
          knowledgePoints: {
            select: { knowledgePoint: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
} satisfies Prisma.ExamAttemptSelect;

export const WRONG_QUESTION_SELECT = {
  id: true,
  questionId: true,
  wrongCount: true,
  masteryStatus: true,
  question: { select: { title: true, type: true } },
} satisfies Prisma.WrongQuestionSelect;

export const STUDENT_LESSON_SELECT = {
  id: true,
  title: true,
  startsAt: true,
  status: true,
  lessonHours: true,
  classGroup: { select: { courseId: true, course: { select: { name: true } } } },
  attendance: { select: { id: true, status: true, confirmedAt: true } },
  lessonRecord: {
    select: {
      id: true,
      status: true,
      publicLearningGoal: true,
      publicClassPerformance: true,
      publicHomework: true,
    },
  },
} satisfies Prisma.LessonSessionSelect;

export const STUDENT_SCRATCH_SELECT = {
  id: true,
  status: true,
  currentVersion: true,
  submittedAt: true,
  assignment: {
    select: {
      id: true,
      title: true,
      sessionId: true,
      session: { select: { startsAt: true, classGroup: { select: { courseId: true } } } },
    },
  },
  reviews: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, score: true, comment: true },
  },
  judgeRuns: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, score: true },
  },
} satisfies Prisma.ScratchWorkSelect;

export type StudentExam = Prisma.ExamGetPayload<{ select: typeof STUDENT_EXAM_SELECT }>;
export type StudentAttempt = Prisma.ExamAttemptGetPayload<{ select: typeof STUDENT_ATTEMPT_SELECT }>;
export type StudentWrongQuestion = Prisma.WrongQuestionGetPayload<{ select: typeof WRONG_QUESTION_SELECT }>;
export type StudentLesson = Prisma.LessonSessionGetPayload<{ select: typeof STUDENT_LESSON_SELECT }>;
export type StudentScratchWork = Prisma.ScratchWorkGetPayload<{ select: typeof STUDENT_SCRATCH_SELECT }>;

export type NormalizedStudentSummaryScope = {
  studentId: string;
  courseId?: string;
  examIds: string[];
  from?: Date;
  to?: Date;
};

export type StudentSummaryDatasetInput = {
  studentId: string;
  scope: NormalizedStudentSummaryScope;
  exams: StudentExam[];
  latestAttempts: Map<string, StudentAttempt>;
  gradedAttempts: StudentAttempt[];
  answers: StudentAnswerFact[];
  wrongQuestions: StudentWrongQuestion[];
  judgeSubmissions: Array<{ status: string; score: Prisma.Decimal | null }>;
  lessons: StudentLesson[];
  scratchWorks: StudentScratchWork[];
};
