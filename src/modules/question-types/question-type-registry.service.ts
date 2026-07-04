import { BadRequestException, Injectable } from '@nestjs/common';
import { AnswerRecordStatus, Prisma } from '@prisma/client';
import { ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import {
  GradeContext,
  JsonSchema,
  QuestionSnapshotLike,
  QuestionTypeAdapter,
  QuestionTypeCapabilities,
  QuestionTypeDescriptor,
  ScoreResult,
} from './question-type.contract';

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): JsonSchema => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties,
  required,
  additionalProperties: true,
});

const emptyObjectSchema = objectSchema({});
const choiceResponseSchema = objectSchema(
  { selectedOptionIds: { type: 'array', items: { type: 'string' }, uniqueItems: true } },
  ['selectedOptionIds'],
);
const fillResponseSchema = objectSchema(
  {
    blanks: {
      type: 'array',
      items: objectSchema({ index: { type: 'integer', minimum: 1 }, value: { type: 'string' } }, ['index', 'value']),
    },
  },
  ['blanks'],
);

const commonCapabilities: QuestionTypeCapabilities = {
  options: false,
  container: false,
  autoGradable: false,
  manualGradable: false,
  judgeGradable: false,
  reusableChild: true,
};

@Injectable()
export class QuestionTypeRegistry {
  private readonly adapters = new Map<string, QuestionTypeAdapter>();
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false });

  constructor() {
    this.registerChoice('single_choice', '单选题', false);
    this.registerChoice('multiple_choice', '多选题', true);
    this.registerChoice('true_false', '判断题', false);
    this.registerFillBlank();
    this.registerManual('short_answer', '简答题', 'short-answer');
    this.registerJudge('programming', '编程题');
    this.registerManual('file_upload', '文件上传题', 'file-upload');
    this.registerManual('scratch_project', 'Scratch 项目题', 'project-upload');
    this.registerManual('arduino_project', 'Arduino 项目题', 'project-upload');
    this.registerMaterial();
  }

  descriptors() {
    return [...this.adapters.values()].map((adapter) => adapter.descriptor);
  }

  descriptor(type: string) {
    return this.adapter(type).descriptor;
  }

  adapter(type: string) {
    const key = this.normalizeType(type);
    const adapter = this.adapters.get(key);
    if (!adapter) throw new BadRequestException(`未注册题型：${type}`);
    return adapter;
  }

  grade(context: GradeContext) {
    return this.adapter(context.snapshot.type).grade(context);
  }

  validate(type: string, definition: unknown) {
    const errors = this.adapter(type).validateDefinition(definition);
    if (errors.length) throw new BadRequestException({ message: '题型数据不符合契约', data: { type, errors } });
  }

  normalizeResponse(type: string, value: unknown) {
    return this.adapter(type).normalizeResponse(value);
  }

  private registerChoice(code: string, label: string, multiple: boolean) {
    const scoringRuleSchema = objectSchema({
      mode: { enum: multiple ? ['exact', 'partial_no_wrong', 'partial_penalty'] : ['exact'] },
      incorrectPenalty: { type: 'number', minimum: 0 },
    });
    this.register(
      this.createAdapter(
        {
          code,
          label,
          version: 1,
          definitionSchema: objectSchema({
            options: { type: 'array', minItems: 2 },
            answer: objectSchema({ correctOptionIds: { type: 'array', items: { type: 'string' }, minItems: 1 } }),
          }),
          responseSchema: choiceResponseSchema,
          scoringRuleSchema,
          editorAdapter: 'choice-editor',
          answerAdapter: 'choice-answer',
          reviewAdapter: 'choice-review',
          statisticsAdapter: 'objective-statistics',
          exportAdapter: 'choice-export',
          capabilities: { ...commonCapabilities, options: true, autoGradable: true },
        },
        (context) => this.gradeChoice(code, context),
      ),
    );
  }

  private registerFillBlank() {
    this.register(
      this.createAdapter(
        {
          code: 'fill_blank',
          label: '填空题',
          version: 1,
          definitionSchema: objectSchema({ answer: objectSchema({ blanks: { type: 'array', minItems: 1 } }) }),
          responseSchema: fillResponseSchema,
          scoringRuleSchema: objectSchema({ matchMode: { enum: ['text', 'numeric', 'regex'] } }),
          editorAdapter: 'fill-blank-editor',
          answerAdapter: 'fill-blank-answer',
          reviewAdapter: 'fill-blank-review',
          statisticsAdapter: 'objective-statistics',
          exportAdapter: 'fill-blank-export',
          capabilities: { ...commonCapabilities, autoGradable: true },
        },
        (context) => this.gradeFillBlank(context),
      ),
    );
  }

  private registerManual(code: string, label: string, adapterName: string) {
    this.register(
      this.createAdapter(
        {
          code,
          label,
          version: 1,
          definitionSchema: emptyObjectSchema,
          responseSchema: emptyObjectSchema,
          scoringRuleSchema: objectSchema({ rubric: { type: 'array', items: { type: 'object' } } }),
          editorAdapter: `${adapterName}-editor`,
          answerAdapter: `${adapterName}-answer`,
          reviewAdapter: `${adapterName}-review`,
          statisticsAdapter: 'subjective-statistics',
          exportAdapter: `${adapterName}-export`,
          capabilities: { ...commonCapabilities, manualGradable: true },
        },
        (context) => this.pending(context, AnswerRecordStatus.MANUAL_NEEDED, code),
      ),
    );
  }

  private registerJudge(code: string, label: string) {
    this.register(
      this.createAdapter(
        {
          code,
          label,
          version: 1,
          definitionSchema: emptyObjectSchema,
          responseSchema: objectSchema({ code: { type: 'string' }, language: { type: 'string' } }),
          scoringRuleSchema: emptyObjectSchema,
          editorAdapter: 'programming-editor',
          answerAdapter: 'programming-answer',
          reviewAdapter: 'programming-review',
          statisticsAdapter: 'judge-statistics',
          exportAdapter: 'programming-export',
          capabilities: { ...commonCapabilities, judgeGradable: true },
        },
        (context) => this.pending(context, AnswerRecordStatus.JUDGE_PENDING, code),
      ),
    );
  }

  private registerMaterial() {
    this.register(
      this.createAdapter(
        {
          code: 'material',
          label: '材料/组合题',
          version: 1,
          definitionSchema: objectSchema({ children: { type: 'array', minItems: 1 } }),
          responseSchema: emptyObjectSchema,
          scoringRuleSchema: emptyObjectSchema,
          editorAdapter: 'material-editor',
          answerAdapter: 'material-answer',
          reviewAdapter: 'material-review',
          statisticsAdapter: 'material-statistics',
          exportAdapter: 'material-export',
          capabilities: { ...commonCapabilities, container: true, reusableChild: false },
        },
        (context) => ({
          ...this.pending(context, AnswerRecordStatus.SUBMITTED, 'material'),
          warnings: ['材料容器不直接判分，成绩由子题汇总'],
        }),
      ),
    );
  }

  private createAdapter(descriptor: QuestionTypeDescriptor, grade: (context: GradeContext) => ScoreResult) {
    const definitionValidator = this.compile(descriptor.definitionSchema);
    const responseValidator = this.compile(descriptor.responseSchema);
    return {
      descriptor,
      validateDefinition: (value: unknown) => this.errors(definitionValidator, value),
      normalizeResponse: (value: unknown) => {
        const candidate = this.record(value);
        const errors = this.errors(responseValidator, candidate);
        if (errors.length) throw new BadRequestException({ message: '答案格式不合法', data: { errors } });
        return candidate as Prisma.InputJsonObject;
      },
      grade,
      toStatistics: (result: ScoreResult) => ({
        score: result.score,
        maxScore: result.maxScore,
        scoreRate: result.maxScore ? result.score / result.maxScore : 0,
        isCorrect: result.isCorrect,
      }),
      toExport: (snapshot: QuestionSnapshotLike) => ({ type: descriptor.code, answer: snapshot.answer ?? null }),
    } satisfies QuestionTypeAdapter;
  }

  private gradeChoice(code: string, context: GradeContext): ScoreResult {
    const response = this.record(context.answer);
    const snapshotAnswer = this.record(context.snapshot.answer);
    const selected = [...new Set(this.strings(response.selectedOptionIds))];
    const correct = [...new Set(this.strings(snapshotAnswer.correctOptionIds))];
    const wrong = selected.filter((id) => !correct.includes(id));
    const matched = selected.filter((id) => correct.includes(id));
    const exact = wrong.length === 0 && matched.length === correct.length && selected.length === correct.length;
    const rule = this.record(context.snapshot.scoringRule);
    const mode = code === 'multiple_choice' ? String(rule.mode ?? 'exact') : 'exact';
    let score = exact ? context.maxScore : 0;
    if (!exact && mode === 'partial_no_wrong' && wrong.length === 0 && correct.length) {
      score = context.maxScore * (matched.length / correct.length);
    }
    if (!exact && mode === 'partial_penalty' && correct.length) {
      const perCorrect = context.maxScore / correct.length;
      const penalty = Number(rule.incorrectPenalty ?? perCorrect);
      score = Math.max(0, matched.length * perCorrect - wrong.length * penalty);
    }
    score = this.roundScore(score, context.maxScore);
    return this.result(context, code, score, exact, {
      mode,
      selectedOptionIds: selected,
      correctOptionIds: correct,
      matchedOptionIds: matched,
      wrongOptionIds: wrong,
    });
  }

  private gradeFillBlank(context: GradeContext): ScoreResult {
    const response = this.record(context.answer);
    const answer = this.record(context.snapshot.answer);
    const submitted = Array.isArray(response.blanks) ? response.blanks : [];
    const rules = Array.isArray(answer.blanks) ? answer.blanks : [];
    let score = 0;
    const details: Prisma.InputJsonValue[] = [];
    for (const [offset, raw] of rules.entries()) {
      const rule = this.record(raw);
      const index = Number(rule.index ?? offset + 1);
      const responseItem = submitted.find((item) => Number(this.record(item).index) === index);
      const value = String(this.record(responseItem).value ?? '');
      const matched = this.matchBlank(value, rule);
      const itemScore = matched ? Number(rule.score ?? context.maxScore / Math.max(rules.length, 1)) : 0;
      score += itemScore;
      details.push({ index, value, matched, score: this.roundScore(itemScore, context.maxScore), mode: String(rule.matchMode ?? 'text') });
    }
    const allCorrect = rules.length > 0 && details.every((item) => Boolean(this.record(item).matched));
    return this.result(context, 'fill_blank', score, allCorrect, { blanks: details });
  }

  private matchBlank(value: string, rule: Record<string, unknown>) {
    const mode = String(rule.matchMode ?? 'text');
    const answers = this.strings(rule.answers);
    if (mode === 'numeric') {
      const actual = Number(value);
      const tolerance = Math.max(0, Number(rule.tolerance ?? 0));
      return Number.isFinite(actual) && answers.some((item) => Number.isFinite(Number(item)) && Math.abs(actual - Number(item)) <= tolerance);
    }
    if (mode === 'regex') {
      return answers.some((pattern) => this.safeRegex(pattern)?.test(value) ?? false);
    }
    const normalized = this.normalizeText(value, rule);
    return answers.map((item) => this.normalizeText(item, rule)).includes(normalized);
  }

  private safeRegex(pattern: string) {
    if (!pattern || pattern.length > 200 || /\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return null;
    try {
      return new RegExp(pattern, 'u');
    } catch {
      return null;
    }
  }

  private normalizeText(value: string, rule: Record<string, unknown>) {
    let result = value;
    if (rule.trimSpace !== false) result = result.trim();
    if (rule.ignoreCase) result = result.toLowerCase();
    return result;
  }

  private pending(context: GradeContext, status: AnswerRecordStatus, adapterKey: string): ScoreResult {
    return {
      score: 0,
      maxScore: context.maxScore,
      isCorrect: null,
      status,
      details: {},
      warnings: [],
      engine: { adapterKey, adapterVersion: this.descriptor(adapterKey).version },
    };
  }

  private result(
    context: GradeContext,
    adapterKey: string,
    score: number,
    isCorrect: boolean,
    details: Prisma.InputJsonObject,
  ): ScoreResult {
    return {
      score: this.roundScore(score, context.maxScore),
      maxScore: context.maxScore,
      isCorrect,
      status: AnswerRecordStatus.AUTO_GRADED,
      details,
      warnings: [],
      engine: { adapterKey, adapterVersion: this.descriptor(adapterKey).version },
    };
  }

  private register(adapter: QuestionTypeAdapter) {
    if (this.adapters.has(adapter.descriptor.code)) throw new Error(`Duplicate question adapter ${adapter.descriptor.code}`);
    this.adapters.set(adapter.descriptor.code, adapter);
  }

  private compile(schema: JsonSchema) {
    return this.ajv.compile(schema);
  }

  private errors(validate: ValidateFunction, value: unknown) {
    return validate(value) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? '不合法'}`);
  }

  private normalizeType(value: string) {
    return String(value).trim().replace(/-/g, '_').toLowerCase();
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  }

  private strings(value: unknown) {
    return Array.isArray(value) ? value.map(String) : [];
  }

  private roundScore(value: number, maxScore: number) {
    return Math.min(maxScore, Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100));
  }
}
