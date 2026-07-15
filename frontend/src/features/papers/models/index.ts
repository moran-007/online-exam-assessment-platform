export type NamedOption = { id: string; name: string };
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number };

export type PaperSnapshotOption = {
  id?: string;
  optionKey: string;
  content: string;
  sortOrder?: number;
  isCorrect?: boolean;
};

export type PaperQuestionSnapshot = {
  type?: string;
  title?: string;
  content?: string;
  analysis?: string;
  options?: PaperSnapshotOption[];
};

export type PaperQuestion = {
  id: string;
  score: number;
  sortOrder: number;
  questionSnapshotJson?: PaperQuestionSnapshot | null;
  editScore?: number;
  editSectionTitle?: string;
};

export type PaperSection = {
  id?: string;
  title: string;
  score: number;
  questions: PaperQuestion[];
};

export type PaperListItem = {
  id: string;
  name: string;
  courseId: string;
  courseName?: string | null;
  course?: NamedOption | null;
  durationMinutes: number;
  type?: string;
  status: string;
  questionCount?: number;
  totalScore?: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  createdAt?: string | null;
  examUsageCount?: number;
  _count?: { exams?: number };
};

export type PaperDetail = PaperListItem & {
  sections?: PaperSection[];
  questions?: PaperQuestion[];
  canEditSnapshots?: boolean;
  snapshotEditReason?: string | null;
};

export type EditablePaperDetail = PaperDetail & {
  sections: PaperSection[];
  questions: PaperQuestion[];
};

export type QuestionListItem = { id: string; title: string; defaultScore?: number };
export type KnowledgeTreeNode = {
  id: string;
  name: string;
  sortOrder?: number;
  children?: KnowledgeTreeNode[];
};
export type KnowledgeTreeOption = {
  label: string;
  value: string;
  children: KnowledgeTreeOption[];
};

export type PaperImportQuestion = Record<string, unknown> & {
  no: number;
  paperName?: string;
  sectionTitle?: string;
  type: string;
  title: string;
  content: string;
  difficulty: number;
  defaultScore: number;
  score: number;
  analysis: string;
  options: PaperSnapshotOption[];
  answer: unknown;
  scoringRule: unknown;
  tagNames: string[];
  knowledgePointNames: string[];
  allowOptionShuffle?: boolean;
  courseId?: string;
};

export type PaperImportPackage = {
  paperName: string;
  durationMinutes: number;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  questions: PaperImportQuestion[];
};

export type PaperImportResult = {
  paperId: string;
  questionCount: number;
  reusedCount: number;
};
export type PaperGenerationResult = { paperId: string; questionCount: number };
export type PaperAddResult = { addedCount: number };
