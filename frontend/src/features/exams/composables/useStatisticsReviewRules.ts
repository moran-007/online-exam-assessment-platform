import { computed, reactive, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { createReviewRule, listReviewRules, removeReviewRule, updateReviewRule } from '../api';
import { getKnowledgePointTree } from '../../questions/api';
import type { KnowledgePointTreeNode } from '../../questions/models';
import type { NamedOption, ReviewRule } from '../models';

type ReviewRuleForm = {
  id: string;
  courseId: string;
  classId: string;
  knowledgePointId: string;
  preset: 'standard' | 'intensive' | 'long_term' | 'custom';
  intervalsText: string;
  correctStreak: number;
  reviewingIntervalDays: number;
  enabled: boolean;
};

type KnowledgeTreeOption = { label: string; value: string; children: KnowledgeTreeOption[] };

export function useStatisticsReviewRules(options: {
  courses: Ref<NamedOption[]>;
  classes: Ref<NamedOption[]>;
  loadStatistics: () => Promise<void>;
}) {
  const reviewRulesVisible = ref(false);
  const reviewRulesLoading = ref(false);
  const reviewRuleSaving = ref(false);
  const reviewRules = ref<ReviewRule[]>([]);
  const reviewKnowledgeTree = ref<KnowledgePointTreeNode[]>([]);
  const reviewKnowledgeMap = ref(new Map<string, string>());
  const reviewPresetOptions = [
    { label: '标准', value: 'standard' },
    { label: '强化', value: 'intensive' },
    { label: '长期', value: 'long_term' },
    { label: '手动', value: 'custom' },
  ];
  const reviewPresetMap: Record<'standard' | 'intensive' | 'long_term', {
    intervalsText: string;
    correctStreak: number;
    reviewingIntervalDays: number;
  }> = {
    standard: { intervalsText: '1,3,7,14,30', correctStreak: 3, reviewingIntervalDays: 3 },
    intensive: { intervalsText: '1,2,4,7,15', correctStreak: 3, reviewingIntervalDays: 2 },
    long_term: { intervalsText: '1,4,8,16,32,64', correctStreak: 4, reviewingIntervalDays: 5 },
  };
  const reviewRuleForm = reactive<ReviewRuleForm>({
    id: '',
    courseId: '',
    classId: '',
    knowledgePointId: '',
    preset: 'standard',
    intervalsText: '1,3,7,14,30',
    correctStreak: 3,
    reviewingIntervalDays: 3,
    enabled: true,
  });
  const reviewKnowledgeTreeOptions = computed(() => convertKnowledgeTree(reviewKnowledgeTree.value));

  async function openReviewRules() {
    reviewRulesVisible.value = true;
    if (!options.courses.value.length || !options.classes.value.length) await options.loadStatistics();
    await loadReviewRules();
  }

  async function loadReviewRules() {
    reviewRulesLoading.value = true;
    try {
      const rules = await listReviewRules();
      reviewRules.value = rules;
      const courseIds = [...new Set(rules.map((item) => item.courseId).filter((id): id is string => Boolean(id)))];
      await Promise.all(courseIds.map((courseId) => loadReviewKnowledgePoints(courseId, { silent: true })));
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '复习规则加载失败'));
    } finally {
      reviewRulesLoading.value = false;
    }
  }

  async function handleReviewRuleCourseChange(courseId: string) {
    reviewRuleForm.knowledgePointId = '';
    reviewKnowledgeTree.value = [];
    if (courseId) await loadReviewKnowledgePoints(courseId);
  }

  async function loadReviewKnowledgePoints(courseId: string, loadOptions: { silent?: boolean } = {}) {
    if (!courseId) return [];
    try {
      const tree = await getKnowledgePointTree(courseId);
      if (!loadOptions.silent) reviewKnowledgeTree.value = tree;
      const nextMap = new Map(reviewKnowledgeMap.value);
      for (const item of flattenKnowledgeTree(tree)) nextMap.set(item.id, item.name);
      reviewKnowledgeMap.value = nextMap;
      return tree;
    } catch (error: unknown) {
      if (!loadOptions.silent) ElMessage.error(errorMessage(error, '知识点加载失败'));
      return [];
    }
  }

  function editReviewRule(value: unknown) {
    const row = reviewRuleFrom(value);
    Object.assign(reviewRuleForm, {
      id: row.id,
      courseId: row.courseId || '',
      classId: row.classId || '',
      knowledgePointId: row.knowledgePointId || '',
      preset: presetFromRule(row),
      intervalsText: (row.intervalsDays || []).join(','),
      correctStreak: Number(row.masteryRule?.correctStreak || 3),
      reviewingIntervalDays: Number(row.masteryRule?.reviewingIntervalDays || 3),
      enabled: Boolean(row.enabled),
    });
    if (row.courseId) void loadReviewKnowledgePoints(row.courseId);
  }

  function resetReviewRuleForm() {
    Object.assign(reviewRuleForm, {
      id: '', courseId: '', classId: '', knowledgePointId: '', preset: 'standard',
      intervalsText: '1,3,7,14,30', correctStreak: 3, reviewingIntervalDays: 3, enabled: true,
    });
    reviewKnowledgeTree.value = [];
  }

  async function saveReviewRule() {
    const intervalsDays = parseIntervalDays(reviewRuleForm.intervalsText);
    if (!intervalsDays.length) {
      ElMessage.warning('请至少填写一个复习间隔天数');
      return;
    }
    reviewRuleSaving.value = true;
    try {
      const body = {
        courseId: reviewRuleForm.courseId || undefined,
        classId: reviewRuleForm.classId || undefined,
        knowledgePointId: reviewRuleForm.knowledgePointId || undefined,
        intervalsDays,
        masteryRule: {
          correctStreak: Number(reviewRuleForm.correctStreak || 3),
          reviewingIntervalDays: Number(reviewRuleForm.reviewingIntervalDays || 3),
        },
        enabled: reviewRuleForm.enabled,
      };
      if (reviewRuleForm.id) {
        await updateReviewRule(reviewRuleForm.id, body);
        ElMessage.success('复习规则已更新');
      } else {
        await createReviewRule(body);
        ElMessage.success('复习规则已创建');
      }
      resetReviewRuleForm();
      await loadReviewRules();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '保存复习规则失败'));
    } finally {
      reviewRuleSaving.value = false;
    }
  }

  async function deleteReviewRule(value: unknown) {
    const row = reviewRuleFrom(value);
    try {
      await ElMessageBox.confirm(`确认删除复习规则“${reviewRuleScope(row)}”？`, '删除复习规则', {
        type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
      });
    } catch { return; }
    try {
      await removeReviewRule(row.id);
      ElMessage.success('复习规则已删除');
      if (reviewRuleForm.id === row.id) resetReviewRuleForm();
      await loadReviewRules();
    } catch (error: unknown) {
      ElMessage.error(errorMessage(error, '删除复习规则失败'));
    }
  }

  function applyReviewPreset(value: ReviewRuleForm['preset']) {
    if (value === 'custom') return;
    Object.assign(reviewRuleForm, reviewPresetMap[value]);
  }

  function presetFromRule(row: ReviewRule): ReviewRuleForm['preset'] {
    const intervalsText = (row.intervalsDays || []).join(',');
    const correctStreak = Number(row.masteryRule?.correctStreak || 3);
    const reviewingIntervalDays = Number(row.masteryRule?.reviewingIntervalDays || 3);
    return (Object.entries(reviewPresetMap) as Array<[Exclude<ReviewRuleForm['preset'], 'custom'>, typeof reviewPresetMap.standard]>)
      .find(([, preset]) => preset.intervalsText === intervalsText && preset.correctStreak === correctStreak && preset.reviewingIntervalDays === reviewingIntervalDays)?.[0] || 'custom';
  }

  function reviewRuleScope(value: unknown) {
    const row = reviewRuleFrom(value);
    return [
      row.courseId ? courseName(row.courseId) : '全部课程',
      row.classId ? className(row.classId) : '全部班级',
      row.knowledgePointId ? knowledgeName(row.knowledgePointId) : '不限知识点',
    ].join(' / ');
  }

  function courseName(id: string) { return options.courses.value.find((item) => item.id === id)?.name || shortId(id); }
  function className(id: string) { return options.classes.value.find((item) => item.id === id)?.name || shortId(id); }
  function knowledgeName(id: string) { return reviewKnowledgeMap.value.get(id) || shortId(id); }

  return {
    applyReviewPreset, className, courseName, deleteReviewRule, editReviewRule,
    handleReviewRuleCourseChange, knowledgeName, loadReviewKnowledgePoints, loadReviewRules,
    openReviewRules, parseIntervalDays, presetFromRule, resetReviewRuleForm,
    reviewKnowledgeMap, reviewKnowledgeTree, reviewKnowledgeTreeOptions, reviewPresetMap,
    reviewPresetOptions, reviewRuleForm, reviewRuleSaving, reviewRuleScope, reviewRules,
    reviewRulesLoading, reviewRulesVisible, saveReviewRule, shortId,
  };
}

function reviewRuleFrom(value: unknown) {
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
    throw new Error('复习规则格式无效');
  }
  return value as ReviewRule;
}

function parseIntervalDays(value: string | number | null | undefined) {
  return [...new Set(String(value || '').split(/[,，、\s]+/).map(Number).filter((item) => Number.isInteger(item) && item > 0))]
    .sort((a, b) => a - b);
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

function shortId(id?: string | null) { return id ? `${String(id).slice(0, 8)}...` : '-'; }
function errorMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }
