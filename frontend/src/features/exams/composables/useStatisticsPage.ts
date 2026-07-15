/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- migrated page state is isolated here while domain models are typed incrementally.
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { DocumentAdd, Download, Refresh, Setting } from '@element-plus/icons-vue';
import {
  createReviewRule,
  generateWrongFrequencyPaper,
  listExamClasses,
  listExamCourses,
  listManagedExams,
  listReviewRules,
  loadStatisticsClassComparison,
  loadStatisticsClasses,
  loadStatisticsExamDetail,
  loadStatisticsExams,
  loadStatisticsKnowledge,
  loadStatisticsKnowledgeTrend,
  loadStatisticsOverview,
  loadStatisticsQuestionDiagnostics,
  loadStatisticsScoreDistribution,
  loadStatisticsWrongQuestions,
  removeReviewRule,
  updateReviewRule,
} from '../api';
import { createExportTask } from '../../exports/api';
import { getKnowledgePointTree } from '../../questions/api';
import { getHydroSummary, writeBackHydroResult } from '../../hydro/api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';

export function useStatisticsPage(): any {
const filter = reactive({ courseId: '', classId: '', examId: '', sourceType: '', dateRange: [] });
const overview = reactive({
  submittedAttempts: 0,
  averageScore: 0,
  maxScore: 0,
  pendingManual: 0,
  activeWrongQuestions: 0,
  gradedCount: 0,
});
const courses = ref([]);
const classes = ref([]);
const exams = ref([]);
const examStats = ref([]);
const knowledgeStats = ref([]);
const classStats = ref([]);
const questionStats = ref([]);
const wrongQuestionStats = ref([]);
const scoreDistribution = ref({ total: 0, averageScore: 0, averagePercent: 0, buckets: [] });
const classComparison = ref([]);
const knowledgeTrend = ref([]);
const questionDiagnostics = ref([]);
const hydroSummary = ref({
  metrics: { answerCount: 0, submissionCount: 0, pendingSubmissionCount: 0, judgedCount: 0, pendingCount: 0, averageScore: 0, maxScore: 0 },
  byQuestion: [],
  items: [],
});
const selectedExamName = ref('');
const exporting = ref(false);
const generatingWrongPaper = ref(false);
const hydroWritebackVisible = ref(false);
const hydroWritebackSaving = ref(false);
const hydroWritebackForm = reactive({
  submissionId: '',
  externalSubmissionId: '',
  status: 'accepted',
  score: 0,
  message: '',
});
const reviewRulesVisible = ref(false);
const reviewRulesLoading = ref(false);
const reviewRuleSaving = ref(false);
const reviewRules = ref([]);
const reviewKnowledgeTree = ref([]);
const reviewKnowledgeMap = ref(new Map());
const reviewPresetOptions = [
  { label: '标准', value: 'standard' },
  { label: '强化', value: 'intensive' },
  { label: '长期', value: 'long_term' },
  { label: '手动', value: 'custom' },
];
const reviewPresetMap = {
  standard: { intervalsText: '1,3,7,14,30', correctStreak: 3, reviewingIntervalDays: 3 },
  intensive: { intervalsText: '1,2,4,7,15', correctStreak: 3, reviewingIntervalDays: 2 },
  long_term: { intervalsText: '1,4,8,16,32,64', correctStreak: 4, reviewingIntervalDays: 5 },
};
const reviewRuleForm = reactive({
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
const { showMediumColumns, showLowColumns } = useResponsiveColumns();

const reviewKnowledgeTreeOptions = computed(() => convertKnowledgeTree(reviewKnowledgeTree.value));

const scoreDistributionOption = computed(() => {
  const buckets = scoreDistribution.value.buckets || [];
  return baseChartOption({
    tooltip: { trigger: 'axis' },
    grid: chartGrid(),
    xAxis: { type: 'category', data: buckets.map((item) => item.label), axisLabel: { interval: 0 } },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '提交次数',
        type: 'bar',
        data: buckets.map((item) => item.count),
        barMaxWidth: 34,
        itemStyle: { color: '#409eff', borderRadius: [5, 5, 0, 0] },
      },
    ],
  });
});

const classComparisonOption = computed(() => {
  const rows = classComparison.value || [];
  return baseChartOption({
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => (Number(value) <= 1 ? `${Math.round(Number(value) * 100)}%` : value),
    },
    legend: { top: 0, right: 0, data: ['均分', '通过率', '完成率'] },
    grid: chartGrid(30),
    xAxis: { type: 'category', data: rows.map((item) => shortLabel(item.className)), axisLabel: { interval: 0, rotate: rows.length > 4 ? 18 : 0 } },
    yAxis: [
      { type: 'value', name: '分数', splitLine: { lineStyle: { color: '#eef2f7' } } },
      { type: 'value', name: '比例', min: 0, max: 1, axisLabel: { formatter: (value) => `${Math.round(value * 100)}%` } },
    ],
    series: [
      { name: '均分', type: 'bar', data: rows.map((item) => Number(item.averageScore || 0)), barMaxWidth: 28, itemStyle: { color: '#409eff', borderRadius: [4, 4, 0, 0] } },
      { name: '通过率', type: 'line', yAxisIndex: 1, data: rows.map((item) => Number(item.passRate || 0)), smooth: true, symbolSize: 6, itemStyle: { color: '#67c23a' } },
      { name: '完成率', type: 'line', yAxisIndex: 1, data: rows.map((item) => Number(item.completionRate || 0)), smooth: true, symbolSize: 6, itemStyle: { color: '#e6a23c' } },
    ],
  });
});

const knowledgeTrendOption = computed(() => {
  const rows = knowledgeTrend.value || [];
  const dates = [...new Set(rows.map((item) => item.date))].sort();
  const names = topKnowledgeTrendNames(rows, 6);
  return baseChartOption({
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${Math.round(Number(value || 0) * 100)}%` },
    legend: { top: 0, type: 'scroll', data: names },
    grid: chartGrid(36),
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value', min: 0, max: 1, axisLabel: { formatter: (value) => `${Math.round(value * 100)}%` } },
    series: names.map((name) => ({
      name,
      type: 'line',
      smooth: true,
      connectNulls: true,
      data: dates.map((date) => rows.find((item) => item.date === date && item.name === name)?.correctRate ?? null),
    })),
  });
});

const questionDiagnosticsOption = computed(() => {
  const rows = questionDiagnostics.value || [];
  return baseChartOption({
    tooltip: {
      formatter(params) {
        const row = params.data?.[4] || {};
        return [
          row.title || '题目',
          `正确率：${percent(row.correctRate)}`,
          `区分度：${formatNumber(row.discrimination)}`,
          `难度偏差：${signed(row.difficultyDelta)}`,
          `异常：${row.anomalyCount || 0}`,
        ].join('<br>');
      },
    },
    grid: chartGrid(),
    xAxis: { type: 'value', name: '区分度', min: -1, max: 1 },
    yAxis: { type: 'value', name: '正确率', min: 0, max: 1, axisLabel: { formatter: (value) => `${Math.round(value * 100)}%` } },
    series: [
      {
        type: 'scatter',
        symbolSize: (value) => Math.min(30, Math.max(9, 9 + Number(value?.[2] || 0) * 2 + Math.abs(Number(value?.[3] || 0)) * 9)),
        data: rows.map((row) => [
          Number(row.discrimination || 0),
          Number(row.correctRate || 0),
          Number(row.anomalyCount || 0),
          Number(row.difficultyDelta || 0),
          row,
        ]),
        itemStyle: {
          color(params) {
            const row = params.data?.[4] || {};
            if (Number(row.anomalyCount || 0) > 0) return '#f56c6c';
            if (Number(row.discrimination || 0) < 0.2) return '#e6a23c';
            return '#67c23a';
          },
        },
      },
    ],
  });
});

async function load() {
  const params = statisticsPayload();
  const [
    coursePage,
    classPage,
    examPage,
    overviewData,
    examPageStats,
    knowledge,
    classData,
    wrongQuestions,
    distribution,
    classCompare,
    trend,
    diagnostics,
    hydroData,
  ] = await Promise.all([
    listExamCourses(),
    listExamClasses(),
    listManagedExams({ pageSize: 100, sortBy: 'createdAt', sortOrder: 'desc' }),
    loadStatisticsOverview(params),
    loadStatisticsExams(params),
    loadStatisticsKnowledge(params),
    loadStatisticsClasses(params),
    loadStatisticsWrongQuestions(params),
    loadStatisticsScoreDistribution(params),
    loadStatisticsClassComparison(params),
    loadStatisticsKnowledgeTrend(params),
    loadStatisticsQuestionDiagnostics(params),
    getHydroSummary(params),
  ]);
  courses.value = coursePage.items;
  classes.value = classPage.items;
  exams.value = examPage.items;
  Object.assign(overview, overviewData);
  examStats.value = examPageStats.items;
  knowledgeStats.value = knowledge;
  classStats.value = classData;
  wrongQuestionStats.value = wrongQuestions;
  scoreDistribution.value = distribution;
  classComparison.value = Array.isArray(classCompare) ? classCompare : [];
  knowledgeTrend.value = Array.isArray(trend) ? trend : [];
  questionDiagnostics.value = Array.isArray(diagnostics) ? diagnostics : [];
  hydroSummary.value = hydroData;
  if (filter.examId) {
    await loadExamDetail({ examId: filter.examId });
  } else {
    questionStats.value = [];
    selectedExamName.value = '';
  }
}

function openHydroWriteback(row) {
  const latest = row.latestSubmission || {};
  Object.assign(hydroWritebackForm, {
    submissionId: latest.submissionId || '',
    externalSubmissionId: latest.externalSubmissionId || '',
    status: latest.status === 'accepted' ? 'accepted' : 'accepted',
    score: Number(row.score || latest.score || 0),
    message: '',
  });
  hydroWritebackVisible.value = true;
}

async function submitHydroWriteback() {
  if (!hydroWritebackForm.submissionId && !hydroWritebackForm.externalSubmissionId) {
    ElMessage.warning('缺少提交记录，无法回写');
    return;
  }

  hydroWritebackSaving.value = true;
  try {
    await writeBackHydroResult({
        externalSubmissionId: hydroWritebackForm.externalSubmissionId || undefined,
        score: Number(hydroWritebackForm.score) || 0,
        status: hydroWritebackForm.status,
        message: hydroWritebackForm.message.trim(),
      }, hydroWritebackForm.submissionId || undefined);
    ElMessage.success('Hydro 判题结果已回写');
    hydroWritebackVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(error.message || 'Hydro 回写失败');
  } finally {
    hydroWritebackSaving.value = false;
  }
}

function statisticsPayload() {
  return {
    courseId: filter.courseId || undefined,
    classId: filter.classId || undefined,
    examId: filter.examId || undefined,
    sourceType: filter.sourceType || undefined,
    startDate: filter.dateRange?.[0],
    endDate: filter.dateRange?.[1],
  };
}

async function loadExamDetail(row) {
  const detail = await loadStatisticsExamDetail(row.examId);
  questionStats.value = detail.questionStats;
  selectedExamName.value = detail.examName;
}

async function exportCurrentStatistics() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    await createExportTask({
        type: 'statistics',
        format: 'csv',
        section: 'current',
        ...statisticsPayload(),
    });
    ElMessage.success('统计导出任务已加入队列，可到导出中心下载');
  } catch (error) {
    ElMessage.error(error.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

async function generateWrongPaper() {
  if (generatingWrongPaper.value) return;
  if (!filter.courseId) {
    ElMessage.warning('请先选择课程，再按当前筛选生成高频错题试卷');
    return;
  }
  generatingWrongPaper.value = true;
  try {
    const result = await generateWrongFrequencyPaper({
        courseId: filter.courseId,
        classId: filter.classId || undefined,
        sourceType: filter.sourceType || undefined,
        startDate: filter.dateRange?.[0],
        endDate: filter.dateRange?.[1],
        count: 20,
        minWrongCount: 1,
    });
    ElMessage.success(`已生成高频错题试卷：${result.name || result.paper?.name || ''}`);
  } catch (error) {
    ElMessage.error(error.message || '生成错题试卷失败');
  } finally {
    generatingWrongPaper.value = false;
  }
}

async function openReviewRules() {
  reviewRulesVisible.value = true;
  if (!courses.value.length || !classes.value.length) {
    await load();
  }
  await loadReviewRules();
}

async function loadReviewRules() {
  reviewRulesLoading.value = true;
  try {
    const rules = await listReviewRules();
    reviewRules.value = rules;
    const courseIds = [...new Set(rules.map((item) => item.courseId).filter(Boolean))];
    await Promise.all(courseIds.map((courseId) => loadReviewKnowledgePoints(courseId, { silent: true })));
  } catch (error) {
    ElMessage.error(error.message || '复习规则加载失败');
  } finally {
    reviewRulesLoading.value = false;
  }
}

async function handleReviewRuleCourseChange(courseId) {
  reviewRuleForm.knowledgePointId = '';
  reviewKnowledgeTree.value = [];
  if (courseId) {
    await loadReviewKnowledgePoints(courseId);
  }
}

async function loadReviewKnowledgePoints(courseId, options = {}) {
  if (!courseId) return [];
  try {
    const tree = await getKnowledgePointTree(courseId);
    if (!options.silent) reviewKnowledgeTree.value = tree;
    const nextMap = new Map(reviewKnowledgeMap.value);
    for (const item of flattenKnowledgeTree(tree)) {
      nextMap.set(item.id, item.name);
    }
    reviewKnowledgeMap.value = nextMap;
    return tree;
  } catch (error) {
    if (!options.silent) ElMessage.error(error.message || '知识点加载失败');
    return [];
  }
}

function editReviewRule(row) {
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
  if (row.courseId) loadReviewKnowledgePoints(row.courseId);
}

function resetReviewRuleForm() {
  Object.assign(reviewRuleForm, {
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
      courseId: reviewRuleForm.courseId || null,
      classId: reviewRuleForm.classId || null,
      knowledgePointId: reviewRuleForm.knowledgePointId || null,
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
  } catch (error) {
    ElMessage.error(error.message || '保存复习规则失败');
  } finally {
    reviewRuleSaving.value = false;
  }
}

async function deleteReviewRule(row) {
  try {
    await ElMessageBox.confirm(`确认删除复习规则“${reviewRuleScope(row)}”？`, '删除复习规则', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  try {
    await removeReviewRule(row.id);
    ElMessage.success('复习规则已删除');
    if (reviewRuleForm.id === row.id) resetReviewRuleForm();
    await loadReviewRules();
  } catch (error) {
    ElMessage.error(error.message || '删除复习规则失败');
  }
}

function applyReviewPreset(value) {
  const preset = reviewPresetMap[value];
  if (!preset) return;
  Object.assign(reviewRuleForm, preset);
}

function presetFromRule(row) {
  const intervalsText = (row.intervalsDays || []).join(',');
  const correctStreak = Number(row.masteryRule?.correctStreak || 3);
  const reviewingIntervalDays = Number(row.masteryRule?.reviewingIntervalDays || 3);
  return Object.entries(reviewPresetMap).find(([, preset]) =>
    preset.intervalsText === intervalsText &&
    preset.correctStreak === correctStreak &&
    preset.reviewingIntervalDays === reviewingIntervalDays
  )?.[0] || 'custom';
}

function reviewRuleScope(row) {
  const parts = [
    row.courseId ? courseName(row.courseId) : '全部课程',
    row.classId ? className(row.classId) : '全部班级',
    row.knowledgePointId ? knowledgeName(row.knowledgePointId) : '不限知识点',
  ];
  return parts.join(' / ');
}

function courseName(id) {
  return courses.value.find((item) => item.id === id)?.name || shortId(id);
}

function className(id) {
  return classes.value.find((item) => item.id === id)?.name || shortId(id);
}

function knowledgeName(id) {
  return reviewKnowledgeMap.value.get(id) || shortId(id);
}

function parseIntervalDays(value) {
  return [
    ...new Set(
      String(value || '')
        .split(/[,，、\s]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item > 0),
    ),
  ].sort((a, b) => a - b);
}

function convertKnowledgeTree(items) {
  return items.map((item) => ({
    label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
    value: item.id,
    children: convertKnowledgeTree(item.children ?? []),
  }));
}

function flattenKnowledgeTree(items) {
  return items.flatMap((item) => [item, ...flattenKnowledgeTree(item.children ?? [])]);
}

function shortId(id) {
  return id ? `${String(id).slice(0, 8)}...` : '-';
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2);
}

function signed(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number.toFixed(2)}` : number.toFixed(2);
}

function sourceLabel(value) {
  const map = {
    exam: '考试',
    practice: '练习',
    manual: '手动',
    ai_recommendation: '推荐',
  };
  return map[value] ?? value;
}

function hydroStatusLabel(value) {
  const map = {
    judge_pending: '待回写',
    judge_done: '已回写',
  };
  return map[value] ?? value;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

function baseChartOption(option) {
  return {
    animationDuration: 350,
    textStyle: { color: '#334155', fontFamily: 'inherit' },
    ...option,
  };
}

function chartGrid(top = 18) {
  return { top, left: 36, right: 20, bottom: 32, containLabel: true };
}

function shortLabel(value) {
  const text = String(value || '-');
  return text.length > 10 ? `${text.slice(0, 10)}...` : text;
}

function topKnowledgeTrendNames(rows, limit) {
  const counts = new Map();
  for (const row of rows) {
    counts.set(row.name, (counts.get(row.name) || 0) + Number(row.answerCount || 0));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

onMounted(load);

return {
  DocumentAdd,
  Download,
  ElMessage,
  ElMessageBox,
  Refresh,
  Setting,
  applyReviewPreset,
  baseChartOption,
  chartGrid,
  classComparison,
  classComparisonOption,
  className,
  classStats,
  classes,
  computed,
  convertKnowledgeTree,
  courseName,
  courses,
  createExportTask,
  createReviewRule,
  deleteReviewRule,
  editReviewRule,
  examStats,
  exams,
  exportCurrentStatistics,
  exporting,
  filter,
  flattenKnowledgeTree,
  formatDate,
  formatNumber,
  generateWrongFrequencyPaper,
  generateWrongPaper,
  generatingWrongPaper,
  getHydroSummary,
  getKnowledgePointTree,
  handleReviewRuleCourseChange,
  hydroStatusLabel,
  hydroSummary,
  hydroWritebackForm,
  hydroWritebackSaving,
  hydroWritebackVisible,
  knowledgeName,
  knowledgeStats,
  knowledgeTrend,
  knowledgeTrendOption,
  listExamClasses,
  listExamCourses,
  listManagedExams,
  listReviewRules,
  load,
  loadExamDetail,
  loadReviewKnowledgePoints,
  loadReviewRules,
  loadStatisticsClassComparison,
  loadStatisticsClasses,
  loadStatisticsExamDetail,
  loadStatisticsExams,
  loadStatisticsKnowledge,
  loadStatisticsKnowledgeTrend,
  loadStatisticsOverview,
  loadStatisticsQuestionDiagnostics,
  loadStatisticsScoreDistribution,
  loadStatisticsWrongQuestions,
  onMounted,
  openHydroWriteback,
  openReviewRules,
  overview,
  parseIntervalDays,
  percent,
  presetFromRule,
  questionDiagnostics,
  questionDiagnosticsOption,
  questionStats,
  reactive,
  ref,
  removeReviewRule,
  resetReviewRuleForm,
  reviewKnowledgeMap,
  reviewKnowledgeTree,
  reviewKnowledgeTreeOptions,
  reviewPresetMap,
  reviewPresetOptions,
  reviewRuleForm,
  reviewRuleSaving,
  reviewRuleScope,
  reviewRules,
  reviewRulesLoading,
  reviewRulesVisible,
  saveReviewRule,
  scoreDistribution,
  scoreDistributionOption,
  selectedExamName,
  shortId,
  shortLabel,
  showLowColumns,
  showMediumColumns,
  signed,
  sourceLabel,
  statisticsPayload,
  submitHydroWriteback,
  topKnowledgeTrendNames,
  updateReviewRule,
  useResponsiveColumns,
  writeBackHydroResult,
  wrongQuestionStats,
};
}
