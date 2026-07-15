import type { Ref } from 'vue';
import { createQuestionTag, getKnowledgePointTree } from '../api';
import type { KnowledgePointTreeNode, KnowledgeTreeOption, NamedOption } from '../models';

type CatalogState = {
  courses: Ref<NamedOption[]>;
  tags: Ref<NamedOption[]>;
  knowledgeTree: Ref<KnowledgePointTreeNode[]>;
  sharedCourseId: Ref<string>;
  sharedCourseTouched: Ref<boolean>;
  sharedKnowledgePointIds: Ref<string[]>;
  blankCaseSensitive: Ref<boolean>;
  blankSpaceSensitive: Ref<boolean>;
  typeOptions: Array<{ label: string; value: string }>;
  refreshPreview: () => void;
};

export function useQuestionImportCatalog(state: CatalogState) {
  const {
    blankCaseSensitive, blankSpaceSensitive, courses, knowledgeTree, refreshPreview,
    sharedCourseId, sharedCourseTouched, sharedKnowledgePointIds, tags, typeOptions,
  } = state;

  async function handleSharedCourseChange() {
    sharedCourseTouched.value = true;
    sharedKnowledgePointIds.value = [];
    await loadKnowledgeTree();
    refreshPreview();
  }

  async function loadKnowledgeTree() {
    knowledgeTree.value = sharedCourseId.value ? await getKnowledgePointTree(sharedCourseId.value) : [];
  }

  async function resolveTagIds(tagNames: string[] = []) {
    const names = [...new Set(tagNames.map((name) => String(name).trim()).filter(Boolean))];
    const ids: string[] = [];

    for (const [index, name] of names.entries()) {
      const existing = tags.value.find((tag) => tag.name === name);
      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const created = await createQuestionTag({
          name,
          code: makeTagCode(name, index),
          type: 'QUESTION',
      });
      ids.push(created.id);
      tags.value.unshift(created);
    }

    return ids;
  }

  function isChoiceType(type: string) {
    return ['single_choice', 'multiple_choice', 'true_false'].includes(type);
  }

  function typeLabel(value: string) {
    return typeOptions.find((item) => item.value === value)?.label ?? value ?? '';
  }

  function parseAnswerKeys(value: unknown) {
    return String(value || '')
      .split(/[,，、|\s]+/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean);
  }

  function isMeaningfulName(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    return Boolean(text) && !['undefined', 'null', '-', '无'].includes(text.toLowerCase());
  }

  function parseTagNames(value: unknown): string[] {
    return String(value || '')
      .split(/[,，、|/]+/)
      .map((item) => item.trim())
      .filter(isMeaningfulName);
  }

  function normalizeCourseName(value: unknown) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return isMeaningfulName(text) ? text : '';
  }

  function selectedCourseName(courseId: string) {
    return courses.value.find((course) => course.id === courseId)?.name ?? '';
  }

  function resolveCourseIdByName(name: unknown) {
    const key = normalizeCourseName(name).toLowerCase();
    if (!key) return '';
    return courses.value.find((course) => normalizeCourseName(course.name).toLowerCase() === key)?.id ?? '';
  }

  function resolveCourseIdForImportedQuestion(sourceCourseId: unknown, courseName: unknown) {
    if (sharedCourseTouched.value && sharedCourseId.value) return sharedCourseId.value;
    const matchedCourseId = resolveCourseIdByName(courseName);
    if (matchedCourseId) return matchedCourseId;
    const sourceId = String(sourceCourseId ?? '').trim();
    if (sourceId && courses.value.some((course) => course.id === sourceId)) return sourceId;
    return sharedCourseTouched.value ? sharedCourseId.value : '';
  }

  function resolveKnowledgePointIdsByName(names: string[] = []): string[] {
    if (!names.length) return [];
    const map = new Map(flattenKnowledgeTree(knowledgeTree.value).map((item) => [item.name, item.id]));
    return names.map((name) => map.get(name)).filter((id): id is string => Boolean(id));
  }

  function convertKnowledgeTree(items: KnowledgePointTreeNode[]): KnowledgeTreeOption[] {
    return items.map((item) => ({
      label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
      value: item.id,
      children: convertKnowledgeTree(item.children ?? []),
    }));
  }

  function flattenKnowledgeTree(items: KnowledgePointTreeNode[]): KnowledgePointTreeNode[] {
    return items.flatMap((item) => [item, ...flattenKnowledgeTree(item.children ?? [])]);
  }

  function mergeTags(...groups: Array<Array<string | null | undefined>>): string[] {
    return [...new Set(groups.flat().map((name) => String(name).trim()).filter(isMeaningfulName))];
  }

  function mergeIds(...groups: string[][]): string[] {
    return [...new Set(groups.flat().filter(Boolean))];
  }

  function blankAnswerOptions() {
    return {
      ignoreCase: !blankCaseSensitive.value,
      trimSpace: !blankSpaceSensitive.value,
    };
  }

  function normalizeAnswerRows(value: unknown, fallback = 6) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.min(24, Math.max(2, Math.round(numberValue)));
  }

  function isTextAnswerType(type: string) {
    return ['short_answer', 'file_upload', 'scratch_project', 'arduino_project'].includes(type);
  }

  function entryTipForType(type: string) {
    const tips: Record<string, { title: string; description: string }> = {
      single_choice: {
        title: '录入提示：单选题需要且只能设置一个正确选项',
        description: '题干、选项和解析都支持 Markdown；如果选项很多，建议先写完内容再选择正确项。',
      },
      multiple_choice: {
        title: '录入提示：多选题至少需要两个正确选项',
        description: '当前判分按题型引擎规则处理；选项内容保持完整，后续导出和判分会复用同一份结构。',
      },
      true_false: {
        title: '录入提示：判断题保留“正确/错误”两个选项',
        description: '只需要选择正确项；如需解释条件或前提，写在题干或解析中。',
      },
      fill_blank: {
        title: '录入提示：填空题题干中的 ____ 会作为学生看到的空位',
        description: '答案区可按空位逐行填写；材料题里的填空小题也使用同一套录入方式。',
      },
      short_answer: {
        title: '录入提示：简答题（单问）只生成一个作答框',
        description: '如果一题包含第 1 问、第 2 问等多组子项，请改为“大题/组合题”后逐题给分。',
      },
      programming: {
        title: '录入提示：编程题优先绑定 Hydro 题号或题目链接',
        description: '绑定外部题后可拉取标题、题面和语言；本地不直接保存外部平台账号密钥。',
      },
      material: {
        title: '录入提示：大题/组合题由“大题说明 + 多道子题”组成',
        description: '子题通过弹窗新增或编辑，默认不会在题库列表中单独展示；右侧预览会按题号紧凑展示完整小题。',
      },
      file_upload: {
        title: '录入提示：文件上传题适合收作业附件或项目文件',
        description: '参考答案可填写提交要求或评分说明；作答框行数只影响学生端输入区高度。',
      },
      scratch_project: {
        title: '录入提示：Scratch 项目题可写项目要求和评分说明',
        description: '学生端按主观/项目类题型提交，后续由教师批改或结合附件检查。',
      },
      arduino_project: {
        title: '录入提示：Arduino 项目题可写接线、代码和验收标准',
        description: '建议把设备要求、提交材料和评分点拆清楚，便于后续批改。',
      },
    };
    return tips[type] ?? {
      title: '录入提示：请先填写题目标题、题干和分值',
      description: '如果当前题型较复杂，建议先保存草稿再进入题库详情中复核。',
    };
  }

  function optionKeyForIndex(index: number) {
    return index < 26 ? String.fromCharCode(65 + index) : `X${index + 1}`;
  }

  function extractField(block: string, label: string) {
    const match = block.match(new RegExp(`^${label}[:：]\\s*(.+)$`, 'm'));
    return match?.[1]?.trim() ?? '';
  }

  function formatBatchErrors(errors: Array<{ number: number; title: string; message: string }>) {
    return errors.map((error) => `第 ${error.number} 题（${error.title}）：${error.message}`).join('；');
  }

  function makeTagCode(name: string, index: number) {
    const ascii = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
    return `q_${ascii || 'tag'}_${Date.now()}_${index}`;
  }

  return { handleSharedCourseChange, loadKnowledgeTree, resolveTagIds, isChoiceType, typeLabel, parseAnswerKeys, isMeaningfulName, parseTagNames, normalizeCourseName, selectedCourseName, resolveCourseIdByName, resolveCourseIdForImportedQuestion, resolveKnowledgePointIdsByName, convertKnowledgeTree, flattenKnowledgeTree, mergeTags, mergeIds, blankAnswerOptions, normalizeAnswerRows, isTextAnswerType, entryTipForType, optionKeyForIndex, extractField, formatBatchErrors, makeTagCode };
}
