import { AnswerRecordStatus, Prisma } from '@prisma/client';

export type JsonSchema = Record<string, unknown>;

export interface QuestionTypeCapabilities {
  options: boolean;
  container: boolean;
  autoGradable: boolean;
  manualGradable: boolean;
  judgeGradable: boolean;
  reusableChild: boolean;
}

export interface QuestionTypeDescriptor {
  code: string;
  label: string;
  version: number;
  definitionSchema: JsonSchema;
  responseSchema: JsonSchema;
  scoringRuleSchema: JsonSchema;
  editorAdapter: string;
  answerAdapter: string;
  reviewAdapter: string;
  statisticsAdapter: string;
  exportAdapter: string;
  capabilities: QuestionTypeCapabilities;
}

export interface QuestionSnapshotLike {
  id?: string;
  type: string;
  answer?: Prisma.JsonValue | null;
  scoringRule?: Prisma.JsonValue | null;
  options?: Array<{ id: string; optionKey?: string; content?: string; isCorrect?: boolean }>;
}

export interface GradeContext {
  snapshot: QuestionSnapshotLike;
  answer: unknown;
  maxScore: number;
}

export interface ScoreResult {
  score: number;
  maxScore: number;
  isCorrect: boolean | null;
  status: AnswerRecordStatus;
  details: Prisma.InputJsonObject;
  warnings: string[];
  engine: { adapterKey: string; adapterVersion: number };
}

export interface QuestionTypeAdapter {
  readonly descriptor: QuestionTypeDescriptor;
  validateDefinition(value: unknown): string[];
  normalizeResponse(value: unknown): Prisma.InputJsonObject;
  grade(context: GradeContext): ScoreResult;
  toStatistics(result: ScoreResult): Prisma.InputJsonObject;
  toExport(snapshot: QuestionSnapshotLike): Prisma.InputJsonObject;
}
