import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { DocumentAdd, Download, Refresh, Setting } from '@element-plus/icons-vue';
import {
  generateWrongFrequencyPaper,
  listExamClasses,
  listExamCourses,
  listManagedExams,
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
} from '../api';
import { createExportTask } from '../../exports/api';
import { getHydroSummary, writeBackHydroResult } from '../../hydro/api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import type { HydroStatisticsSummary, HydroSummaryItem } from '../../hydro/models';
import type {
  ClassPerformance,
  ExamPerformance,
  KnowledgePerformance,
  KnowledgeTrendPoint,
  ManagedExamSummary,
  NamedOption,
  QuestionDiagnostic,
  QuestionPerformance,
  ScoreDistribution,
  StatisticsOverview,
  WrongQuestionStatistic,
} from '../models';
import { useStatisticsCharts } from './useStatisticsCharts';
import { useStatisticsReviewRules } from './useStatisticsReviewRules';

type StatisticsSource = '' | 'exam' | 'practice' | 'manual' | 'ai_recommendation';
type StatisticsFilter = {
  courseId: string;
  classId: string;
  examId: string;
  sourceType: StatisticsSource;
  dateRange: [] | [string, string];
};
type StatisticsParams = Parameters<typeof loadStatisticsOverview>[0];

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('记录格式无效');
  return value as Record<string, unknown>;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function hydroSummaryItemFrom(value: unknown) {
  const row = recordValue(value);
  if (typeof row.answerRecordId !== 'string') throw new Error('Hydro 统计记录格式无效');
  return row as HydroSummaryItem;
}

export function useStatisticsPage() {
const filter = reactive<StatisticsFilter>({ courseId: '', classId: '', examId: '', sourceType: '', dateRange: [] });
const overview = reactive<StatisticsOverview>({
  submittedAttempts: 0,
  averageScore: 0,
  maxScore: 0,
  pendingManual: 0,
  activeWrongQuestions: 0,
  gradedCount: 0,
});
const courses = ref<NamedOption[]>([]);
const classes = ref<NamedOption[]>([]);
const exams = ref<ManagedExamSummary[]>([]);
const examStats = ref<ExamPerformance[]>([]);
const knowledgeStats = ref<KnowledgePerformance[]>([]);
const classStats = ref<ClassPerformance[]>([]);
const questionStats = ref<QuestionPerformance[]>([]);
const wrongQuestionStats = ref<WrongQuestionStatistic[]>([]);
const scoreDistribution = ref<ScoreDistribution>({ total: 0, averageScore: 0, averagePercent: 0, buckets: [] });
const classComparison = ref<ClassPerformance[]>([]);
const knowledgeTrend = ref<KnowledgeTrendPoint[]>([]);
const questionDiagnostics = ref<QuestionDiagnostic[]>([]);
const hydroSummary = ref<HydroStatisticsSummary>({
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
const { showMediumColumns, showLowColumns } = useResponsiveColumns();

const { scoreDistributionOption, classComparisonOption, knowledgeTrendOption, questionDiagnosticsOption } =
  useStatisticsCharts({ scoreDistribution, classComparison, knowledgeTrend, questionDiagnostics });
const reviewRulesContext = useStatisticsReviewRules({ courses, classes, loadStatistics: load });

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

function openHydroWriteback(value: unknown) {
  const row = hydroSummaryItemFrom(value);
  Object.assign(hydroWritebackForm, {
    submissionId: row.latestSubmission?.submissionId || '',
    externalSubmissionId: row.latestSubmission?.externalSubmissionId || '',
    status: 'accepted',
    score: Number(row.score || row.latestSubmission?.score || 0),
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
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, 'Hydro 回写失败'));
  } finally {
    hydroWritebackSaving.value = false;
  }
}

function statisticsPayload(): StatisticsParams {
  return {
    courseId: filter.courseId || undefined,
    classId: filter.classId || undefined,
    examId: filter.examId || undefined,
    sourceType: filter.sourceType || undefined,
    startDate: filter.dateRange?.[0],
    endDate: filter.dateRange?.[1],
  };
}

async function loadExamDetail(value: unknown) {
  const row = recordValue(value);
  if (typeof row.examId !== 'string') throw new Error('考试统计记录缺少考试 ID');
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
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, '导出失败'));
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
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, '生成错题试卷失败'));
  } finally {
    generatingWrongPaper.value = false;
  }
}

function percent(value: unknown) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatNumber(value: unknown) {
  return Number(value || 0).toFixed(2);
}

function signed(value: unknown) {
  const number = Number(value || 0);
  return number > 0 ? `+${number.toFixed(2)}` : number.toFixed(2);
}

function sourceLabel(value: string) {
  const map: Record<string, string> = {
    exam: '考试',
    practice: '练习',
    manual: '手动',
    ai_recommendation: '推荐',
  };
  return map[value] ?? value;
}

function hydroStatusLabel(value: string) {
  const map: Record<string, string> = {
    judge_pending: '待回写',
    judge_done: '已回写',
  };
  return map[value] ?? value;
}

function formatDate(value: string | Date | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

onMounted(load);

return {
  ...reviewRulesContext,
  DocumentAdd,
  Download,
  Refresh,
  Setting,
  classComparisonOption,
  classStats,
  classes,
  courses,
  examStats,
  exams,
  exportCurrentStatistics,
  exporting,
  filter,
  formatDate,
  formatNumber,
  generateWrongPaper,
  generatingWrongPaper,
  hydroStatusLabel,
  hydroSummary,
  hydroWritebackForm,
  hydroWritebackSaving,
  hydroWritebackVisible,
  knowledgeStats,
  knowledgeTrendOption,
  load,
  loadExamDetail,
  openHydroWriteback,
  overview,
  percent,
  questionDiagnostics,
  questionDiagnosticsOption,
  questionStats,
  scoreDistribution,
  scoreDistributionOption,
  selectedExamName,
  showLowColumns,
  showMediumColumns,
  signed,
  sourceLabel,
  submitHydroWriteback,
  wrongQuestionStats,
};
}
