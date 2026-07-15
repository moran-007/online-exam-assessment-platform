import type { ComputedRef, Ref } from 'vue';
import type {
  BatchParseResult,
  BatchPreviewRow,
  ProgrammingReference,
  QuestionAnswer,
  QuestionChild,
  QuestionMutationPayload,
  QuestionOption,
} from '../models';
import { buildFillBlankAnswer } from '../../../utils/fillBlankAnswers';

type AnswerConfig = { byIndex: Map<number, string>; byTitle: Map<string, string> };
type ParsedOption = { optionKey: string; contentLines: string[] };
type ProgrammingRefInput = {
  judgeProvider?: unknown; externalProblemId?: unknown; externalProblemUrl?: unknown;
  platformBaseUrl?: unknown; domainId?: unknown; domainName?: unknown; accountId?: unknown;
  accountLabel?: unknown; languagesText?: unknown; timeLimit?: unknown; memoryLimit?: unknown; judgeConfig?: unknown;
};
type QuestionValidationPayload = Omit<
  Pick<QuestionMutationPayload, 'courseId' | 'courseName' | 'type' | 'title' | 'content' | 'difficulty' | 'defaultScore' | 'options' | 'answer' | 'inlineChildren'>,
  'answer'
> & { answer?: QuestionAnswer | null; children?: QuestionChild[]; knowledgePointIds?: string[]; knowledgePointNames?: string[] };

type ParserState = {
  sharedCourseId: Ref<string>;
  sharedKnowledgePointIds: Ref<string[]>;
  sharedTagNames: Ref<string[]>;
  selectedKnowledgeNames: ComputedRef<string[]>;
  selectedCourseName: (courseId: string) => string;
  resolveCourseIdForImportedQuestion: (sourceCourseId: unknown, courseName: unknown) => string;
  resolveKnowledgePointIdsByName: (names?: string[]) => string[];
  mergeTags: (...groups: Array<Array<string | null | undefined>>) => string[];
  mergeIds: (...groups: string[][]) => string[];
  normalizeType: (value: unknown) => string;
  normalizeCourseName: (value: unknown) => string;
  typeLabel: (value: string) => string;
  parseAnswerKeys: (value: unknown) => string[];
  parseTagNames: (value: unknown) => string[];
  isChoiceType: (type: string) => boolean;
  isTextAnswerType: (type: string) => boolean;
  normalizeAnswerRows: (value: unknown, fallback?: number) => number;
  blankAnswerOptions: () => { ignoreCase: boolean; trimSpace: boolean };
  optionKeyForIndex: (index: number) => string;
  extractField: (block: string, label: string) => string;
  buildProgrammingRefFromValues: (input: ProgrammingRefInput) => ProgrammingReference | null;
};

export function useQuestionBatchParser(state: ParserState) {
  const {
    blankAnswerOptions, buildProgrammingRefFromValues, extractField, isChoiceType,
    normalizeCourseName, normalizeType, optionKeyForIndex, parseAnswerKeys,
    parseTagNames, resolveCourseIdForImportedQuestion, resolveKnowledgePointIdsByName, selectedCourseName,
    sharedCourseId,
  } = state;

  function errorMessage(error: unknown, fallback = '操作失败') {
    return error instanceof Error ? error.message : fallback;
  }

  function splitQuestionBlocks(text: string) {
    const blocks: string[] = [];
    let current: string[] = [];
    let inCode = false;
    let inMath = false;

    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      const fenceCount = (line.match(/```/g) ?? []).length;
      const trimmed = line.trim();
      if (!inCode && (trimmed === '$$' || trimmed === '\\[' || trimmed === '\\]')) {
        inMath = !inMath;
      }
      if (!inCode && !inMath && trimmed === '---') {
        const block = current.join('\n').trim();
        if (block) blocks.push(block);
        current = [];
        continue;
      }
      current.push(line);
      if (fenceCount % 2 === 1) inCode = !inCode;
    }

    const last = current.join('\n').trim();
    if (last) blocks.push(last);
    return blocks;
  }

  function parseBatchResult(text: string, answerText = ''): BatchParseResult {
    const blocks = splitQuestionBlocks(text);
    if (!blocks.length) throw new Error('请先粘贴题目模板内容');
    const answerConfig = parseAnswerConfig(answerText);
    const rows = blocks.map((block, index) => {
      const number = index + 1;
      try {
        return parseQuestionBlock(block, number, answerConfig);
      } catch (error) {
        return {
          valid: false,
          number,
          title: extractField(block, '标题') || `第 ${number} 题`,
          type: normalizeType(extractField(block, '题型') || ''),
            courseId: sharedCourseId.value,
            courseName: selectedCourseName(sharedCourseId.value),
            knowledgePointIds: [],
            knowledgePointNames: [],
            content: '',
            difficulty: 1,
            defaultScore: Number(extractField(block, '分值') || 0),
            analysis: '',
            options: [],
          answerText: '',
          tagNames: parseTagNames(extractField(block, '标签')),
          statusText: `格式错误：${errorMessage(error)}`,
          errorMessage: errorMessage(error),
        };
      }
    });

    return {
      rows,
      errors: rows
        .filter((row) => row.valid === false)
        .map((row) => ({ number: row.number, title: row.title, message: row.errorMessage ?? '格式错误' })),
    };
  }

  function parseAnswerConfig(text: string): AnswerConfig {
    const byIndex = new Map<number, string>();
    const byTitle = new Map<string, string>();

    for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const indexMatch = line.match(/^(\d+)[.、:：]\s*(.+)$/);
      if (indexMatch) {
        byIndex.set(Number(indexMatch[1]), indexMatch[2].trim());
        continue;
      }

      const titleMatch = line.match(/^(.+?)[:：]\s*(.+)$/);
      if (titleMatch) {
        byTitle.set(titleMatch[1].trim(), titleMatch[2].trim());
      }
    }

    return { byIndex, byTitle };
  }

  function parseQuestionBlock(block: string, number: number, answerConfig: AnswerConfig): BatchPreviewRow {
    const fields: Record<string, string> = {};
    const sections: Record<'content' | 'options' | 'analysis', string[]> = { content: [], options: [], analysis: [] };
    const fieldMap: Record<string, string> = {
      标题: 'title',
      课程: 'courseName',
      题型: 'type',
      难度: 'difficulty',
      分值: 'defaultScore',
      标签: 'tags',
      知识点: 'knowledgePoints',
      答案: 'answer',
      hydro题目: 'hydroProblem',
      hydro题号: 'hydroProblem',
      hydroproblem: 'hydroProblem',
      hydroproblemid: 'hydroProblem',
      hydroproblemname: 'hydroProblem',
      externalproblemid: 'hydroProblem',
      hydro链接: 'hydroUrl',
      hydro地址: 'hydroUrl',
      hydroproblemurl: 'hydroUrl',
      externalproblemurl: 'hydroUrl',
      hydro语言: 'hydroLanguages',
      hydrolanguages: 'hydroLanguages',
    };
    const sectionMap: Record<string, 'content' | 'options' | 'analysis'> = { 题干: 'content', 选项: 'options', 解析: 'analysis' };
    let currentSection: 'content' | 'options' | 'analysis' | '' = '';

    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      const fieldMatch = trimmed.match(/^(标题|课程|题型|难度|分值|标签|知识点|答案|Hydro\s*题目|Hydro\s*题号|hydroProblem|hydroProblemId|hydroProblemName|externalProblemId|Hydro\s*链接|Hydro\s*地址|hydroProblemUrl|externalProblemUrl|Hydro\s*语言|hydroLanguages)[:：]\s*(.*)$/i);
      if (!currentSection && fieldMatch) {
        const fieldKey = fieldMatch[1].replace(/\s+/g, '').toLowerCase();
        fields[fieldMap[fieldKey] ?? fieldMap[fieldMatch[1]]] = fieldMatch[2].trim();
        continue;
      }

      const sectionMatch = trimmed.match(/^(题干|选项|解析)[:：]\s*(.*)$/);
      if (sectionMatch) {
        currentSection = sectionMap[sectionMatch[1]];
        if (sectionMatch[2]) sections[currentSection].push(sectionMatch[2]);
        continue;
      }

      if (currentSection) {
        sections[currentSection].push(line);
      }
    }

    const type = normalizeType(fields.type || '单选题');
    const defaultScore = Number(fields.defaultScore || 2);
    const difficulty = Number(fields.difficulty || 1);
    const title = fields.title || `未命名题目 ${number}`;
    const answerText = answerConfig.byIndex.get(number) ?? answerConfig.byTitle.get(title) ?? fields.answer ?? '';
    const answerKeys = parseAnswerKeys(answerText);
    const knowledgePointNames = parseTagNames(fields.knowledgePoints);
    const courseName = normalizeCourseName(fields.courseName);
    const courseId = courseName ? resolveCourseIdForImportedQuestion('', courseName) : sharedCourseId.value;
    const payload: BatchPreviewRow = {
      valid: true,
      number,
      courseId,
      courseName: selectedCourseName(courseId) || courseName,
      knowledgePointIds: resolveKnowledgePointIdsByName(knowledgePointNames),
      knowledgePointNames,
      type,
      title,
      tagNames: parseTagNames(fields.tags),
      content: sections.content.join('\n').trim(),
      difficulty: Number.isFinite(difficulty) ? difficulty : 1,
      defaultScore: Number.isFinite(defaultScore) ? defaultScore : 2,
      analysis: sections.analysis.join('\n').trim(),
      options: [],
      statusText: '待导入',
    };

    if (isChoiceType(type)) {
      payload.options = parseOptions(sections.options.join('\n'), answerKeys, type);
    }

    if (type === 'programming') {
      payload.programmingRef = buildProgrammingRefFromValues({
        externalProblemId: fields.hydroProblem,
        externalProblemUrl: fields.hydroUrl,
        languagesText: fields.hydroLanguages,
      });
    }

    if (type === 'fill_blank') {
      payload.answer = buildFillBlankAnswer(answerText, payload.defaultScore, blankAnswerOptions());
    } else if (!isChoiceType(type) && answerText) {
      payload.answer = { reference: answerText };
    }

    validatePayload(payload, `第 ${number} 题`);
    return {
      ...payload,
      answerText: answerText || (payload.options ?? []).filter((option) => option.isCorrect).map((option) => option.optionKey).join(','),
      statusText: '待导入',
    };
  }

  function parseOptions(text: string, answerKeys: string[], type: string): QuestionOption[] {
    if (type === 'true_false' && !text.trim()) {
      const truthy = answerKeys.includes('A') || answerKeys.includes('正确') || answerKeys.includes('TRUE');
      return [
        { optionKey: 'A', content: '正确', isCorrect: truthy || !answerKeys.length, sortOrder: 1 },
        { optionKey: 'B', content: '错误', isCorrect: !truthy && answerKeys.length > 0, sortOrder: 2 },
      ];
    }

    const options: ParsedOption[] = [];
    let current: ParsedOption | null = null;
    let inCode = false;

    for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
      const match = !inCode ? line.match(/^\s*([A-Z])[.、:：]\s*(.*)$/i) : null;
      if (match) {
        if (current) options.push(current);
        current = { optionKey: match[1].toUpperCase(), contentLines: [match[2]] };
      } else if (current) {
        current.contentLines.push(line);
      }

      const fenceCount = (line.match(/```/g) ?? []).length;
      if (fenceCount % 2 === 1) inCode = !inCode;
    }
    if (current) options.push(current);

    return options.map((option, index) => ({
      optionKey: option.optionKey || optionKeyForIndex(index),
      content: option.contentLines.join('\n').trim(),
      isCorrect: answerKeys.includes(option.optionKey),
      sortOrder: index + 1,
    }));
  }

  function validatePayload(payload: QuestionValidationPayload, label: string) {
    if (!payload.courseId && !normalizeCourseName(payload.courseName)) throw new Error(`${label}：请选择课程或填写课程名称`);
    if (!payload.title?.trim()) throw new Error(`${label}：请填写标题`);
    if (!payload.content?.trim()) throw new Error(`${label}：请填写题干`);
    if (!Number.isFinite(Number(payload.difficulty)) || payload.difficulty < 1 || payload.difficulty > 5) {
      throw new Error(`${label}：难度必须是 1-5`);
    }
    if (!Number.isFinite(Number(payload.defaultScore)) || payload.defaultScore < 0) {
      throw new Error(`${label}：分值不能小于 0`);
    }

    if (isChoiceType(payload.type)) {
      const options = payload.options ?? [];
      const correctCount = options.filter((option) => option.isCorrect).length;
      if (options.length < 2 || options.some((option) => !option.content?.trim())) {
        throw new Error(`${label}：请至少填写两个完整选项`);
      }
      if ((payload.type === 'single_choice' || payload.type === 'true_false') && correctCount !== 1) {
        throw new Error(`${label}：单选/判断题必须有且只有一个正确选项`);
      }
      if (payload.type === 'multiple_choice' && correctCount < 2) {
        throw new Error(`${label}：多选题至少需要两个正确选项`);
      }
    }

    if (payload.type === 'fill_blank') {
      const blanks = payload.answer?.blanks ?? [];
      if (!blanks.length || blanks.every((blank) => !blank.answers?.length)) {
        throw new Error(`${label}：请至少填写一个空位答案`);
      }
    }

    if (payload.type === 'material') {
      const children = payload.inlineChildren ?? [];
      if (!children.length) {
        throw new Error(`${label}：材料/组合题至少需要添加一道子题`);
      }
      children.forEach((child, index) => {
        validatePayload({
          ...child,
          type: child.type ?? '',
          title: child.title ?? '',
          content: child.content ?? '',
          difficulty: child.difficulty ?? 1,
          courseId: payload.courseId,
          courseName: payload.courseName,
          defaultScore: child.score,
          knowledgePointIds: payload.knowledgePointIds,
          knowledgePointNames: payload.knowledgePointNames,
        }, `${label}子题 ${index + 1}`);
        if (!Number.isFinite(Number(child.score)) || Number(child.score) <= 0) {
          throw new Error(`${label}：第 ${index + 1} 道子题分值必须大于 0`);
        }
      });
      if (new Set(children.map((child) => `${child.type}:${child.title}:${child.content}`)).size !== children.length) {
        throw new Error(`${label}：材料/组合题不能重复添加完全相同的子题`);
      }
    }
  }

  return { splitQuestionBlocks, parseBatchResult, parseAnswerConfig, parseQuestionBlock, parseOptions, validatePayload };
}
