export type HydroRecord = Record<string, unknown>;

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type HydroUserOption = {
  id: string;
  username: string;
  realName?: string | null;
  userType?: string | null;
};

export type HydroPlatform = {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  sortOrder: number;
};

export type HydroAccountStatus = 'success' | 'failed' | 'blocked' | null;

export type HydroAccountView = {
  id: string;
  studentId: string;
  ownerId?: string;
  ownerName?: string | null;
  studentName?: string | null;
  ownerUsername?: string | null;
  username?: string | null;
  platformCode: string;
  platformName?: string | null;
  platformBaseUrl: string;
  loginUsername?: string | null;
  hydroUsername: string;
  hydroUserId: string;
  hasPassword?: boolean;
  bindStatus: 'bound' | 'disabled' | string;
  lastLoginStatus?: HydroAccountStatus;
  lastLoginMessage?: string | null;
  lastLoginAt?: string | null;
};

export type HydroLoginResult = HydroAccountView & {
  success: boolean;
  status: Exclude<HydroAccountStatus, null>;
  message: string;
};

export type HydroLoginState = Pick<HydroAccountView, 'lastLoginStatus' | 'lastLoginMessage'>;

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

export type HydroSubmissionResult = {
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

export type HydroProblemReference = {
  externalProblemId?: string;
  externalProblemUrl?: string;
  platformBaseUrl?: string;
  judgeProvider?: string;
  domainId?: string;
  domainName?: string;
  accountId?: string;
  accountLabel?: string;
  languages?: string[];
  timeLimit?: number | null;
  memoryLimit?: number | null;
  judgeConfig?: {
    platformBaseUrl?: string;
    platformCode?: string;
    domainId?: string;
    domainName?: string;
    accountId?: string;
    accountLabel?: string;
  } | null;
};

export type HydroPulledProblem = HydroProblemReference & {
  title?: string;
  content?: string;
  programmingRef?: HydroProblemReference;
};
