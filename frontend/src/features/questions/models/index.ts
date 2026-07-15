export type QuestionStatus = 'draft' | 'pending_review' | 'published' | 'disabled';
export type QuestionConflictStatus = 'ok' | 'conflict' | 'duplicate' | 'similar';

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type NamedOption = {
  id: string;
  name: string;
  code?: string | null;
  courseId?: string;
};

export type KnowledgePointTreeNode = NamedOption & {
  sortOrder?: number | null;
  children?: KnowledgePointTreeNode[];
};

export type QuestionOption = {
  id?: string;
  optionKey: string;
  content: string;
  isCorrect: boolean;
  sortOrder: number;
};

export type FillBlankRule = {
  index: number;
  answers: string[];
  ignoreCase?: boolean;
  trimSpace?: boolean;
  score?: number;
};

export type QuestionAnswer = {
  answerJson?: QuestionAnswer;
  correctOptionIds?: string[];
  blanks?: FillBlankRule[];
  reference?: string;
  text?: string;
  code?: string;
  language?: string;
  rows?: number;
};

export type ProgrammingJudgeConfig = {
  platformBaseUrl?: string;
  platformCode?: string;
  domainId?: string;
  domainName?: string;
  accountId?: string;
  accountLabel?: string;
};

export type ProgrammingReference = {
  externalProblemId: string;
  externalProblemUrl?: string;
  platformBaseUrl?: string;
  domainId?: string;
  domainName?: string;
  judgeProvider?: string;
  accountId?: string;
  accountLabel?: string;
  languages?: string[];
  languagesText?: string;
  timeLimit?: number | null;
  memoryLimit?: number | null;
  judgeConfig?: ProgrammingJudgeConfig | null;
};

export type EditableProgrammingReference = ProgrammingReference & {
  externalProblemId: string;
  externalProblemUrl: string;
  platformBaseUrl: string;
  domainId: string;
  domainName: string;
  judgeProvider: string;
  accountId: string;
  accountLabel: string;
  languagesText: string;
};

export type QuestionChild = {
  inline?: boolean;
  localId?: string;
  questionId?: string;
  score: number;
  sortOrder: number;
  type?: string;
  title?: string;
  content?: string;
  difficulty?: number;
  analysis?: string;
  answerRows?: number;
  answerText?: string;
  blankRows?: FillBlankRow[];
  options?: QuestionOption[];
  answer?: QuestionAnswer;
  allowOptionShuffle?: boolean;
  programmingRef?: ProgrammingReference | null;
  question?: QuestionRecord;
  snapshot?: QuestionRecord;
};

export type MaterialQuestionChild = QuestionChild & {
  localId: string;
  type: string;
  title: string;
  content: string;
  difficulty: number;
  analysis: string;
  answerRows: number;
  answerText: string;
  blankRows: FillBlankRow[];
  options: QuestionOption[];
};

export type QuestionRecord = {
  id: string;
  questionId?: string;
  type: string;
  title: string;
  content: string;
  status?: QuestionStatus | string;
  difficulty: number;
  defaultScore: number;
  score?: number;
  analysis?: string;
  courseId?: string;
  courseName?: string;
  course?: NamedOption | null;
  knowledgePoints?: NamedOption[];
  knowledgePointIds?: string[];
  knowledgePointNames?: string[];
  tags?: NamedOption[];
  tagIds?: string[];
  tagNames?: string[];
  options?: QuestionOption[];
  answer?: QuestionAnswer | null;
  scoringRule?: QuestionAnswer | null;
  programmingRef?: ProgrammingReference | null;
  children?: QuestionChild[];
  inlineChildren?: QuestionChild[];
  childIds?: string[];
  allowOptionShuffle?: boolean;
  blankCount?: number;
  createdAt?: string;
  updatedAt?: string;
  occupationExams?: Array<{ id: string; name?: string }>;
  message?: string;
};

export type QuestionPage = PageResult<QuestionRecord>;

export type FillBlankRow = { answerText: string };
export type PracticeBlank = { index: number; value: string };
export type PracticeAnswer = {
  selectedOptionIds: string[];
  blanks: PracticeBlank[];
  text: string;
  code: string;
  language: string;
};

export type AnswerCheckResult = {
  isCorrect: boolean | null;
  score: number;
  totalScore: number;
  status: string;
  message?: string;
  details?: Array<{
    childIndex: number;
    questionId: string;
    score: number;
    totalScore: number;
    isCorrect: boolean | null;
    status: string;
  }>;
};

export type QuestionForm = {
  courseId: string;
  knowledgePointIds: string[];
  type: string;
  status: QuestionStatus;
  title: string;
  content: string;
  difficulty: number;
  defaultScore: number;
  analysis: string;
  tagNames: string[];
  options: QuestionOption[];
  children: QuestionChild[];
  programmingRef: EditableProgrammingReference;
  allowOptionShuffle: boolean;
};

export type QuestionMutationPayload = {
  courseId?: string;
  courseName?: string;
  type: string;
  status?: QuestionStatus;
  title: string;
  content: string;
  difficulty: number;
  defaultScore: number;
  analysis?: string;
  knowledgePointIds?: string[];
  knowledgePointNames?: string[];
  tagIds?: string[];
  tagNames?: string[];
  options?: QuestionOption[];
  children?: Array<{ questionId: string; score: number; sortOrder: number }>;
  inlineChildren?: QuestionChild[];
  answer?: QuestionAnswer;
  scoringRule?: QuestionAnswer;
  programmingRef?: ProgrammingReference | null;
  allowOptionShuffle?: boolean;
};

export type SingleQuestionForm = {
  type: string;
  title: string;
  content: string;
  difficulty: number;
  defaultScore: number;
  answerRows: number;
  analysis: string;
  programmingRef: EditableProgrammingReference;
  children: MaterialQuestionChild[];
  options: QuestionOption[];
};

export type HydroSiteOption = {
  key: string;
  value: string;
  judgeProvider: string;
  label: string;
};

export type KnowledgeTreeOption = {
  label: string;
  value: string;
  children: KnowledgeTreeOption[];
};

export type QuestionAnswerSubmission = {
  selectedOptionIds?: string[];
  blanks?: PracticeBlank[];
  text?: string;
  code?: string;
  language?: string;
};

export type DuplicateMatch = {
  id?: string;
  questionId?: string;
  title?: string;
  status?: string;
  similarity?: number;
};

export type DuplicateCheckItem = {
  index: number;
  status: QuestionConflictStatus;
  message: string;
  matches: DuplicateMatch[];
};

export type DuplicateCheckResult = {
  items: DuplicateCheckItem[];
  conflictCount: number;
  duplicateCount: number;
  similarCount: number;
};

export type BatchPreviewRow = Omit<QuestionRecord, 'id'> & {
  id?: string;
  number: number;
  valid: boolean;
  statusText: string;
  answerText?: string;
  conflictStatus?: QuestionConflictStatus;
  conflictMessage?: string;
  conflictMatches?: DuplicateMatch[];
  batchKey?: string;
  errorMessage?: string;
};

export type BatchParseResult = {
  rows: BatchPreviewRow[];
  errors: Array<{ number: number; title: string; message: string }>;
};

export type PortableQuestion = QuestionMutationPayload & {
  id?: string;
  course?: NamedOption | null;
  answer?: QuestionAnswer;
  analysis: string;
  tagNames: string[];
  knowledgePointNames: string[];
  options: QuestionOption[];
};

export type StoredZipEntry = {
  name: string;
  data: Uint8Array;
};

export type QuestionAssetCleanupResult = {
  deleted: Array<{ url: string; filename?: string }>;
  deletedCount: number;
  failedCount: number;
};

export type QuestionAsset = {
  filename: string;
  url: string;
  displayName?: string | null;
  savedDisplayName?: string | null;
  markdown?: string;
  isImage?: boolean;
  width?: number;
  align?: 'left' | 'center' | 'right' | string;
  previewUrl?: string;
  previewObjectUrl?: string;
  size?: number;
  kind?: string;
};

export type QuestionAssetReport = {
  total: number;
  referencedCount: number;
  orphanCount: number;
  items?: Array<{
    url: string;
    displayName?: string | null;
    filename: string;
    referenced: boolean;
    referenceCount?: number;
    managed?: boolean;
    kind: string;
    size?: number | null;
    locations?: string[];
  }>;
};

export type BulkQuestionResult = {
  successCount: number;
  status?: QuestionStatus;
  failed?: Array<{ id?: string; message?: string }>;
};

export type QuestionDeleteImpact = {
  references: {
    paperCount?: number;
    paperQuestionCount?: number;
    examCount?: number;
    activeExamCount?: number;
    paperInstanceCount?: number;
    answerRecordCount?: number;
    wrongQuestionCount?: number;
  };
  relatedPapers: Array<{ id?: string; name: string }>;
  resources: Array<{
    referenceCount?: number;
    locations?: string[];
    managed?: boolean;
  }>;
  risks: string[];
};
