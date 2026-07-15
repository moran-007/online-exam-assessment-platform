import { Injectable } from '@nestjs/common';
import { Prisma, TagType } from '@prisma/client';
import { normalizeQuestionType, toApiEnum } from '../../common/utils/enum-normalizer';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuestionDto } from '../questions/dto/create-question.dto';
import { QuestionDuplicateUseCases } from '../questions/questions.use-cases';

type SnapshotObject = Record<string, unknown>;

@Injectable()
export class PaperImportNormalizer {
  constructor(
    readonly prisma: PrismaService,
    readonly questionDuplicates: QuestionDuplicateUseCases,
  ) {}

  normalizeImportedQuestionRecord(record: Record<string, unknown>): Record<string, unknown> {
      const importPayload = this.parseJsonish(record.importPayload);
      const source =
        importPayload && typeof importPayload === 'object' && !Array.isArray(importPayload)
          ? { ...record, ...(importPayload as Record<string, unknown>) }
          : { ...record };
      const answer = this.parseJsonish(source.answerJson ?? source.answer);
      const options = this.applyImportedAnswerToOptions(
        this.normalizeImportedOptions(source.optionsJson ?? source.options),
        answer,
      );
      const type = this.normalizeImportedQuestionType(String(source.type || 'single_choice'));
      const programmingRef = this.normalizeImportedProgrammingRef(source, type);

      return {
        ...source,
        type,
        title: String(source.title || '未命名题目').trim(),
        content: String(source.contentMarkdown ?? source.content ?? '').trim(),
        difficulty: this.clampNumber(source.difficulty, 1, 5, 1),
        defaultScore: this.nonNegativeNumber(source.defaultScore ?? source.score, 2),
        score: this.nonNegativeNumber(source.score ?? source.defaultScore, 2),
        analysis: String(source.analysisMarkdown ?? source.analysis ?? '').trim(),
        options,
        answer: this.normalizeImportedAnswer(answer, String(source.type || 'single_choice')),
        scoringRule: this.toJsonObject(this.parseJsonish(source.scoringRuleJson ?? source.scoringRule)),
        tagNames: this.normalizeNameList(source.tagNames ?? source.tags),
        knowledgePointNames: this.normalizeNameList(source.knowledgePointNames ?? source.knowledgePoints),
        allowOptionShuffle: this.optionalBoolean(source.allowOptionShuffle),
        programmingRef,
        sectionTitle: String(source.sectionTitle ?? source.section ?? '').trim(),
      };
    }

  async toImportedQuestionCreateDto(record: Record<string, unknown>, courseId: string): Promise<CreateQuestionDto> {
      const tagIds = await this.resolveQuestionTagIds(record.tagNames);
      const knowledgePointIds = await this.resolveKnowledgePointIds(courseId, record.knowledgePointNames);

      return {
        courseId,
        type: String(record.type || 'single_choice'),
        title: String(record.title || '未命名题目').trim(),
        content: String(record.content || '').trim(),
        difficulty: this.clampNumber(record.difficulty, 1, 5, 1),
        defaultScore: this.nonNegativeNumber(record.defaultScore ?? record.score, 2),
        analysis: String(record.analysis ?? '').trim(),
        allowOptionShuffle: this.optionalBoolean(record.allowOptionShuffle),
        knowledgePointIds,
        tagIds,
        options: (Array.isArray(record.options) ? record.options : []) as CreateQuestionDto['options'],
        answer: this.toJsonObject(record.answer),
        scoringRule: this.toJsonObject(record.scoringRule),
        programmingRef: record.programmingRef as CreateQuestionDto['programmingRef'],
      };
    }

  async findDuplicateQuestionId(payload: CreateQuestionDto) {
      const checked = await this.questionDuplicates.checkDuplicates([payload]);
      return checked.items[0]?.matches.find(
        (match) => match.source === 'question_bank' && match.reason === 'duplicate' && match.id,
      )?.id;
    }

  async canReuseImportedQuestion(questionId: string, payload: CreateQuestionDto) {
      const importedRef = payload.type === 'programming' ? payload.programmingRef : null;
      const importedExternalId = String(importedRef?.externalProblemId ?? '').trim();
      if (!importedExternalId) return true;

      const existingRef = await this.prisma.programmingProblemRef.findUnique({ where: { questionId } });
      if (!existingRef) return false;
      return existingRef.externalProblemId === importedExternalId;
    }

  async resolveImportedSection(
      tx: Prisma.TransactionClient,
      paperId: string,
      title: string,
      cache: Map<string, string>,
    ) {
      const normalized = title.trim();
      if (!normalized) return null;
      const cached = cache.get(normalized);
      if (cached) return cached;

      const section = await tx.paperSection.create({
        data: {
          paperId,
          title: normalized.slice(0, 128),
          sortOrder: cache.size + 1,
        },
      });
      cache.set(normalized, section.id);
      return section.id;
    }

  async resolveQuestionTagIds(value: unknown) {
      const names = this.normalizeNameList(value);
      const ids: string[] = [];
      for (const name of names) {
        const existing = await this.prisma.tag.findFirst({
          where: { deletedAt: null, type: TagType.QUESTION, name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) {
          ids.push(existing.id);
          continue;
        }
        const created = await this.prisma.tag.create({
          data: {
            name: name.slice(0, 64),
            code: this.generatedTagCode(name),
            type: TagType.QUESTION,
          },
        });
        ids.push(created.id);
      }
      return ids;
    }

  async resolveKnowledgePointIds(courseId: string, value: unknown) {
      const names = this.normalizeNameList(value);
      const ids: string[] = [];
      for (const name of names) {
        const existing = await this.prisma.knowledgePoint.findFirst({
          where: { courseId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) ids.push(existing.id);
      }
      return ids;
    }

  normalizeImportedOptions(value: unknown): NonNullable<CreateQuestionDto['options']> {
      const parsed = this.parseJsonish(value);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((option, index) => {
        const item = this.toSnapshotObject(option);
        return {
          optionKey: String(item.optionKey ?? item.label ?? this.optionKeyForIndex(index)).trim() || this.optionKeyForIndex(index),
          content: String(item.content ?? item.contentMarkdown ?? '').trim(),
          isCorrect: item.isCorrect === true || item.isCorrect === 'true',
          sortOrder: this.clampNumber(item.sortOrder ?? index + 1, 1, 999, index + 1),
          id: typeof item.id === 'string' ? item.id : typeof item.optionId === 'string' ? item.optionId : undefined,
        } as NonNullable<CreateQuestionDto['options']>[number] & { id?: string };
      });
    }

  applyImportedAnswerToOptions(options: NonNullable<CreateQuestionDto['options']>, answer: unknown) {
      const answerObject = this.toJsonObject(answer);
      const correctOptionIds = Array.isArray(answerObject.correctOptionIds)
        ? new Set(answerObject.correctOptionIds.map((item) => String(item)))
        : new Set<string>();
      if (!correctOptionIds.size && typeof answer === 'string') {
        for (const key of answer.split(/[，,\s]+/).map((item) => item.trim()).filter(Boolean)) {
          correctOptionIds.add(key);
        }
      }

      return options.map((option) => ({
        ...option,
        isCorrect:
          Boolean(option.isCorrect) ||
          correctOptionIds.has(String((option as typeof option & { id?: string }).id ?? '')) ||
          correctOptionIds.has(String(option.optionKey)),
      }));
    }

  normalizeImportedAnswer(value: unknown, type: string) {
      const parsed = this.parseJsonish(value);
      const apiType = this.normalizeImportedQuestionType(type);
      if (apiType === 'fill_blank' && typeof parsed === 'string') {
        return { blanks: [{ index: 1, answers: parsed.split(/[，,]/).map((item) => item.trim()).filter(Boolean), trimSpace: true }] };
      }
      if (['short_answer', 'programming', 'material', 'file_upload', 'scratch_project', 'arduino_project'].includes(apiType) && typeof parsed === 'string') {
        return { reference: parsed };
      }
      return this.toJsonObject(parsed);
    }

  normalizeImportedProgrammingRef(source: Record<string, unknown>, type: string): CreateQuestionDto['programmingRef'] | null {
      if (type !== 'programming') return null;
      const explicit = this.toJsonObject(
        this.parseJsonish(source.programmingRef ?? source.hydroBinding ?? source.judgeBinding ?? source.hydro),
      );
      const explicitJudgeConfig = this.toJsonObject(this.parseJsonish(explicit.judgeConfig));
      const sourceJudgeConfig = this.toJsonObject(this.parseJsonish(source.judgeConfigJson ?? source.judgeConfig));
      const judgeConfig = { ...sourceJudgeConfig, ...explicitJudgeConfig };
      const externalProblemUrl = this.firstText(
        explicit.externalProblemUrl,
        explicit.hydroProblemUrl,
        explicit.hydroUrl,
        source.externalProblemUrl,
        source.hydroProblemUrl,
        source.hydroUrl,
        source.sourceUrl,
      );
      const externalProblemId = this.firstText(
        explicit.externalProblemId,
        explicit.hydroProblemId,
        explicit.hydroProblemName,
        explicit.hydroProblem,
        source.externalProblemId,
        source.hydroProblemId,
        source.hydroProblemName,
        source.hydroProblem,
        source.ojProblemId,
        source.problemId,
        this.problemIdFromImportedProblemUrl(externalProblemUrl),
      );
      if (!externalProblemId) return null;

      const platformBaseUrl = this.normalizeHydroBaseUrl(
        this.firstText(
          explicit.platformBaseUrl,
          judgeConfig.platformBaseUrl,
          source.platformBaseUrl,
          source.hydroBaseUrl,
          this.baseUrlFromImportedProblemUrl(externalProblemUrl),
        ),
      );
      const domainId =
        this.firstText(
          explicit.domainId,
          judgeConfig.domainId,
          source.domainId,
          source.hydroDomainId,
          this.domainIdFromImportedProblemUrl(externalProblemUrl),
        ) || 'system';
      const domainName = this.firstText(explicit.domainName, judgeConfig.domainName, source.domainName, source.hydroDomainName) || domainId;
      const languages = this.normalizeImportedLanguageList(
        explicit.languages ??
          explicit.languageConfig ??
          explicit.languageConfigJson ??
          source.languages ??
          source.hydroLanguages ??
          source.languageConfig ??
          source.languageConfigJson,
      );
      const normalizedProblemUrl =
        externalProblemUrl || this.defaultImportedHydroProblemUrl(externalProblemId, platformBaseUrl, domainId);
      const accountId = this.uuidText(explicit.accountId ?? judgeConfig.accountId ?? source.accountId);
      const accountLabel = this.firstText(explicit.accountLabel, judgeConfig.accountLabel, source.accountLabel);

      return {
        judgeProvider: this.firstText(explicit.judgeProvider, source.judgeProvider) || 'hydro',
        externalProblemId,
        externalProblemUrl: normalizedProblemUrl,
        platformBaseUrl,
        domainId,
        domainName,
        accountId: accountId || undefined,
        accountLabel: accountLabel || undefined,
        languages,
        timeLimit: this.optionalPositiveInteger(explicit.timeLimit ?? source.timeLimit),
        memoryLimit: this.optionalPositiveInteger(explicit.memoryLimit ?? source.memoryLimit),
        judgeConfig: {
          ...judgeConfig,
          platformBaseUrl,
          domainId,
          domainName,
          accountId: accountId || null,
          accountLabel,
          sourceUrl: this.firstText(judgeConfig.sourceUrl, source.sourceUrl, normalizedProblemUrl),
        },
      };
    }

  normalizeImportedQuestionType(type: string) {
      const map: Record<string, string> = {
        单选题: 'single_choice',
        多选题: 'multiple_choice',
        判断题: 'true_false',
        填空题: 'fill_blank',
        简答题: 'short_answer',
        编程题: 'programming',
        材料题: 'material',
        文件上传题: 'file_upload',
        scratch项目题: 'scratch_project',
        arduino项目题: 'arduino_project',
      };
      const normalized = map[type.trim().toLowerCase()] ?? map[type.trim()] ?? type.trim();
      return toApiEnum(normalizeQuestionType(normalized || 'single_choice'));
    }

  parseJsonish(value: unknown): unknown {
      if (value && typeof value === 'object') return value;
      const text = String(value ?? '').trim();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

  toJsonObject(value: unknown): Record<string, unknown> {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
      return {};
    }

  normalizeNameList(value: unknown) {
      const parsed = this.parseJsonish(value);
      if (Array.isArray(parsed)) {
        return [
          ...new Set(
            parsed
              .map((item) => (typeof item === 'string' ? item : this.toSnapshotObject(item).name))
              .map((name) => String(name ?? '').trim())
              .filter((name) => name && name !== '-' && name.toLowerCase() !== 'undefined'),
          ),
        ];
      }
      return [
        ...new Set(
          String(parsed ?? '')
            .split(/[，,;；、]/)
            .map((name) => name.trim())
            .filter((name) => name && name !== '-' && name.toLowerCase() !== 'undefined'),
        ),
      ];
    }

  normalizeImportedLanguageList(value: unknown) {
      const parsed = this.parseJsonish(value);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))];
      }
      const record = this.toJsonObject(parsed);
      if (Array.isArray(record.languages)) {
        return [...new Set(record.languages.map((item) => String(item).trim()).filter(Boolean))];
      }
      if (parsed && typeof parsed === 'object') return [];
      return this.normalizeNameList(parsed);
    }

  firstText(...values: unknown[]) {
      for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = String(value).trim();
        if (text && text !== '-' && text.toLowerCase() !== 'undefined' && text !== '[object Object]') {
          return text;
        }
      }
      return '';
    }

  uuidText(value: unknown) {
      const text = this.firstText(value);
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
        ? text
        : '';
    }

  optionalPositiveInteger(value: unknown) {
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined;
    }

  normalizeHydroBaseUrl(value?: string | null) {
      const raw = String(value || process.env.HYDRO_BASE_URL || 'https://oj.example.com').trim();
      const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      return withScheme.replace(/\/+$/, '');
    }

  baseUrlFromImportedProblemUrl(url?: string | null) {
      const raw = String(url || '').trim();
      if (!raw) return '';
      try {
        const parsed = new URL(raw);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return '';
      }
    }

  domainIdFromImportedProblemUrl(url?: string | null) {
      const raw = String(url || '').trim();
      if (!raw) return '';
      try {
        const parsed = new URL(raw);
        const match = parsed.pathname.match(/\/d\/([^/]+)\/p\//);
        return match?.[1] ? decodeURIComponent(match[1]) : 'system';
      } catch {
        const match = raw.match(/\/d\/([^/]+)\/p\//);
        return match?.[1] ? decodeURIComponent(match[1]) : '';
      }
    }

  problemIdFromImportedProblemUrl(url?: string | null) {
      const raw = String(url || '').trim();
      if (!raw) return '';
      const match = raw.match(/\/p\/([^/?#]+)/);
      return match?.[1] ? decodeURIComponent(match[1]) : '';
    }

  defaultImportedHydroProblemUrl(problemId: string, baseUrl: string, domainId?: string) {
      const normalizedBaseUrl = this.normalizeHydroBaseUrl(baseUrl);
      const normalizedDomain = String(domainId || '').trim();
      const domainPrefix = normalizedDomain && normalizedDomain !== 'system' ? `/d/${encodeURIComponent(normalizedDomain)}` : '';
      return `${normalizedBaseUrl}${domainPrefix}/p/${encodeURIComponent(problemId)}`;
    }

  optionalBoolean(value: unknown) {
      if (value === true || value === 'true' || value === '1' || value === 1) return true;
      if (value === false || value === 'false' || value === '0' || value === 0) return false;
      return undefined;
    }

  clampNumber(value: unknown, min: number, max: number, fallback: number) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return fallback;
      return Math.min(max, Math.max(min, Math.round(numeric)));
    }

  nonNegativeNumber(value: unknown, fallback: number) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return fallback;
      return Math.max(0, numeric);
    }

  toSnapshotObject(value: unknown): SnapshotObject {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return { ...(value as SnapshotObject) };
    }

  optionKeyForIndex(index: number) {
      return String.fromCharCode(65 + index);
    }

  generatedTagCode(name: string) {
      const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 32) || 'tag';
      return `import_${base}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 64);
    }

  importedPaperName(name?: unknown) {
      const base = String(name || '').trim() || '导入试卷';
      const stamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
      return `${base} 导入 ${stamp}`.slice(0, 128);
    }
}
