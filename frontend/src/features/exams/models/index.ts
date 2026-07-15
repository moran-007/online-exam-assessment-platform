export type ExamRecord = Record<string, unknown>;

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type ExamPage = PageResult<ExamRecord>;
export type NamedOption = { id: string; name: string };
export type ManagedExamSummary = NamedOption & { status?: string; createdAt?: string | null };

export type ExamResultVisibility = {
  questionScore: boolean;
  content: boolean;
  studentAnswer: boolean;
  correctness: boolean;
  correctAnswer: boolean;
  analysis: boolean;
};

export type ManagedExam = NamedOption & {
  courseId: string;
  courseName?: string | null;
  classId?: string | null;
  className?: string | null;
  paperId: string;
  paperName?: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  attemptLimit: number;
  announcement?: string | null;
  resultVisibility?: Partial<ExamResultVisibility> | null;
  status: string;
  createdAt?: string | null;
};

export type ExamPaperOption = NamedOption & { durationMinutes?: number | null };
export type ExamStudentOption = { id: string; username: string; realName?: string | null };
export type ExamResultRow = {
  id?: string;
  rank: number;
  studentName: string;
  username: string;
  attemptNo: number;
  totalScore: number;
  objectiveScore: number;
  status: string;
  submittedAt?: string | null;
};

export type ExamBatchResult = { successCount: number; failed?: Array<{ id?: string; message?: string }> };
export type ExamEndResult = ManagedExam & { finalizedAttemptCount?: number };
export type AnnouncementReadItem = {
  studentId?: string;
  username: string;
  realName?: string | null;
  read: boolean;
  readAt?: string | null;
  entered: boolean;
  submitted: boolean;
};
export type AnnouncementReadReport = {
  examId: string;
  examName: string;
  announcement?: { version: number; content: string } | null;
  expectedCount: number;
  readCount: number;
  unreadCount: number;
  enteredCount: number;
  submittedCount?: number;
  items: AnnouncementReadItem[];
};
export type AnnouncementReminderResult = { createdCount: number; skippedCount: number };

export type ProgrammingReference = {
  externalProblemId?: string | null;
  externalProblemUrl?: string | null;
  platformBaseUrl?: string | null;
  accountId?: string | null;
  domainId?: string | null;
  domainName?: string | null;
  languages?: string[];
};

export type ExamQuestion = {
  questionId: string;
  type: string;
  title: string;
  content: string;
  score: number;
  blankCount?: number | null;
  children?: ExamQuestion[];
  programmingRef?: ProgrammingReference | null;
  answer?: { blanks?: Array<{ index: number }> } | null;
  options?: Array<{ id: string; optionKey?: string; content: string; isCorrect?: boolean }>;
};

export type ExamPaperSection = { id?: string | null; title: string; questions: ExamQuestion[] };
export type ExamTakingPaper = { sections: ExamPaperSection[] };
export type ExamTakingExam = {
  id: string;
  name: string;
  durationMinutes: number;
  startTime: string;
  endTime: string;
  serverTime: string;
  announcement?: string | null;
};
export type AnswerBlank = { index: number; value: string };
export type ExamAnswerDraft = {
  selectedOptionIds: string[];
  blanks: AnswerBlank[];
  text: string;
  code: string;
  language: string;
};
export type SavedExamAnswer = {
  questionId: string;
  answer?: {
    selectedOptionIds?: string[];
    blanks?: AnswerBlank[];
    text?: string;
    code?: string;
    language?: string;
    hydro?: {
      submissionId?: string;
      externalSubmissionId?: string;
      mode?: string;
      problemUrl?: string;
    };
  } | null;
  status: string;
  score?: number | null;
  isCorrect?: boolean | null;
  autoResult?: {
    latestSubmissionId?: string;
    externalSubmissionId?: string;
    status?: string;
    maxScore?: number;
    passedTestCaseCount?: number;
    totalTestCaseCount?: number;
    scoreRate?: number;
    mode?: string;
    problemUrl?: string;
    recordUrl?: string;
    message?: string;
    result?: { recordUrl?: string };
  } | null;
};
export type ExamAttemptView = {
  attemptId: string;
  status?: string;
  attemptStartedAt?: string;
  answers?: SavedExamAnswer[];
  exam: ExamTakingExam;
  paper?: ExamTakingPaper;
};
export type ExamSaveResult = { finalized?: boolean } & Record<string, unknown>;
export type ExamSubmitResult = { attemptId?: string } & Record<string, unknown>;

export type MaterialContext = { title: string; content: string };
export type ExamQuestionEntry = {
  question: ExamQuestion;
  sectionTitle: string;
  materialContext: MaterialContext | null;
  index: number;
};

export type ProgrammingSubmissionResult = {
  submissionId?: string;
  externalSubmissionId?: string | null;
  status?: string | null;
  isCorrect?: boolean | null;
  score?: number | null;
  maxScore?: number | null;
  passedTestCaseCount?: number | null;
  totalTestCaseCount?: number | null;
  scoreRate?: number | null;
  language?: string | null;
  mode?: string | null;
  problemUrl?: string | null;
  recordUrl?: string | null;
  message?: string | null;
  result?: Record<string, unknown> | null;
};

export type ProgrammingSubmissionFeedback = {
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  status: string;
  language: string;
  externalSubmissionId: string;
  score: number | null;
  maxScore: number;
  passedTestCaseCount: number | null;
  totalTestCaseCount: number | null;
  scoreRate: number | null;
  isCorrect: boolean | null;
  submissionId: string;
  problemUrl: string;
  recordUrl: string;
};

export type StatisticsOverview = {
  submittedAttempts: number;
  averageScore: number;
  maxScore: number;
  pendingManual: number;
  activeWrongQuestions: number;
  gradedCount: number;
  courses?: number;
  questions?: number;
  papers?: number;
  exams?: number;
  classes?: number;
  minScore?: number;
};

export type ExamPerformance = {
  examId: string;
  examName: string;
  courseName: string;
  className: string;
  submitCount: number;
  averageScore: number;
  maxScore: number;
  minScore?: number;
  fullScore?: number;
  status?: string;
  gradedCount?: number;
};

export type KnowledgePerformance = {
  id?: string;
  name: string;
  answerCount: number;
  correctRate: number;
  averageScore: number;
};

export type ClassPerformance = {
  classId: string;
  className: string;
  courseName: string;
  studentCount: number;
  submitCount: number;
  averageScore: number;
  maxScore?: number;
  minScore?: number;
  passRate: number;
  completionRate: number;
};

export type QuestionPerformance = {
  questionId: string;
  title: string;
  type: string;
  difficulty: number;
  answerCount: number;
  correctRate: number;
  averageScore: number;
};

export type WrongQuestionStatistic = {
  questionId: string;
  title: string;
  type: string;
  difficulty: number;
  courseName: string;
  knowledgePointNames: string[];
  wrongCount: number;
  studentCount: number;
  latestAt: string;
  sourceSummary: Array<{ source: string; count: number }>;
  masterySummary?: Array<{ masteryStatus: string; count: number }>;
};

export type ScoreDistribution = {
  total: number;
  averageScore: number;
  averagePercent: number;
  buckets: Array<{ label: string; min: number; max: number; count: number; percent?: number }>;
};

export type KnowledgeTrendPoint = {
  date: string;
  name: string;
  correctRate: number;
  answerCount: number;
};

export type QuestionDiagnostic = QuestionPerformance & {
  actualDifficulty: number;
  difficultyDelta: number;
  discrimination: number;
  anomalyCount: number;
  knowledgePointNames: string[];
  tagNames: string[];
  suggestion: string;
};

export type ExamStatisticsDetail = ExamPerformance & { questionStats: QuestionPerformance[] };

export type ReviewRule = {
  id: string;
  courseId?: string | null;
  classId?: string | null;
  knowledgePointId?: string | null;
  intervalsDays: number[];
  masteryRule?: { correctStreak?: number; reviewingIntervalDays?: number } | null;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type GeneratedPaperResult = { name?: string; paper?: { name?: string } };

export type HydroSummaryItem = {
  answerRecordId: string;
  examName: string;
  studentName: string;
  questionTitle: string;
  externalProblemId: string;
  score: number;
  status: string;
  latestSubmission?: {
    submissionId: string;
    externalSubmissionId?: string | null;
    status: string;
    score?: number | null;
  } | null;
};

export type HydroStatisticsSummary = {
  metrics: {
    answerCount: number;
    submissionCount: number;
    pendingSubmissionCount: number;
    judgedCount: number;
    pendingCount: number;
    averageScore: number;
    maxScore: number;
  };
  byQuestion: Array<{ questionId: string; title: string; answerCount: number; judgedCount: number; averageScore: number }>;
  items: HydroSummaryItem[];
};
