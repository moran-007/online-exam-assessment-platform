<template>
  <div class="page statistics-page">
    <div class="page-head statistics-head">
      <h1 class="page-title">统计分析</h1>
      <div class="toolbar statistics-toolbar">
        <el-select v-model="filter.courseId" clearable filterable placeholder="课程" @change="load">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-select v-model="filter.classId" clearable filterable placeholder="班级" @change="load">
          <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="filter.examId" clearable filterable placeholder="考试" @change="load">
          <el-option v-for="exam in exams" :key="exam.id" :label="exam.name" :value="exam.id" />
        </el-select>
        <el-select v-model="filter.sourceType" clearable placeholder="错题来源" @change="load">
          <el-option label="考试错题" value="exam" />
          <el-option label="练习错题" value="practice" />
          <el-option label="手动加入" value="manual" />
        </el-select>
        <el-date-picker
          v-model="filter.dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          value-format="YYYY-MM-DD"
          @change="load"
        />
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button plain :icon="Setting" @click="openReviewRules">复习规则</el-button>
        <el-button type="primary" plain :icon="Download" :loading="exporting" @click="exportCurrentStatistics">
          导出当前筛选
        </el-button>
        <el-button type="success" plain :icon="DocumentAdd" :loading="generatingWrongPaper" @click="generateWrongPaper">
          高频错题组卷
        </el-button>
      </div>
    </div>

    <StatisticsMetrics :overview="overview" :hydro-summary="hydroSummary" />

    <div class="statistics-insight-grid">
      <div class="panel statistics-card">
        <div class="section-head">
          <h2>成绩分布</h2>
          <span class="muted">共 {{ scoreDistribution.total || 0 }} 次提交</span>
        </div>
        <EChartPanel :option="scoreDistributionOption" height="100%" />
      </div>

      <div class="panel statistics-card">
        <div class="section-head">
          <h2>班级对比</h2>
          <span class="muted">通过率 / 完成率</span>
        </div>
        <EChartPanel :option="classComparisonOption" height="100%" />
      </div>

      <div class="panel statistics-card">
        <div class="section-head">
          <h2>知识点趋势</h2>
          <span class="muted">按日期聚合</span>
        </div>
        <EChartPanel :option="knowledgeTrendOption" height="100%" />
      </div>

      <div class="panel statistics-card statistics-diagnostic-card">
        <div class="section-head">
          <h2>题目诊断</h2>
          <span class="muted">区分度、难度回归与异常识别</span>
        </div>
        <EChartPanel :option="questionDiagnosticsOption" height="180px" />
        <el-table :data="questionDiagnostics" height="calc(100% - 190px)" class="question-list-table compact-table">
          <el-table-column prop="title" label="题目" min-width="220" show-overflow-tooltip />
          <el-table-column prop="correctRate" label="正确率" width="88">
            <template #default="{ row }">{{ percent(row.correctRate) }}</template>
          </el-table-column>
          <el-table-column prop="discrimination" label="区分度" width="88">
            <template #default="{ row }">{{ formatNumber(row.discrimination) }}</template>
          </el-table-column>
          <el-table-column prop="difficultyDelta" label="难度偏差" width="96">
            <template #default="{ row }">{{ signed(row.difficultyDelta) }}</template>
          </el-table-column>
          <el-table-column prop="anomalyCount" label="异常" width="76" />
          <el-table-column v-if="showMediumColumns" prop="suggestion" label="建议" min-width="220" show-overflow-tooltip />
        </el-table>
      </div>
    </div>

    <div class="panel library-table-panel statistics-detail-panel">
      <el-tabs class="statistics-tabs">
        <el-tab-pane label="考试表现">
          <el-table :data="examStats" height="100%" class="question-list-table" @row-click="loadExamDetail">
            <el-table-column prop="examName" label="考试" min-width="180" show-overflow-tooltip />
            <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
            <el-table-column v-if="showLowColumns" prop="className" label="班级" width="130" show-overflow-tooltip />
            <el-table-column prop="submitCount" label="提交" width="80" />
            <el-table-column prop="averageScore" label="平均分" width="100" />
            <el-table-column v-if="showMediumColumns" prop="maxScore" label="最高" width="80" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="知识点表现">
          <el-table :data="knowledgeStats" height="100%" class="question-list-table">
            <el-table-column prop="name" label="知识点" min-width="180" show-overflow-tooltip />
            <el-table-column prop="answerCount" label="作答" width="80" />
            <el-table-column prop="correctRate" label="正确率" width="100">
              <template #default="{ row }">{{ percent(row.correctRate) }}</template>
            </el-table-column>
            <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="班级概览">
          <el-table :data="classStats" height="100%" class="question-list-table">
            <el-table-column prop="className" label="班级" min-width="160" show-overflow-tooltip />
            <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
            <el-table-column prop="studentCount" label="学生" width="80" />
            <el-table-column prop="submitCount" label="提交" width="80" />
            <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="Hydro 判题">
          <el-table :data="hydroSummary.items || []" height="100%" class="question-list-table">
            <el-table-column prop="examName" label="考试" min-width="150" show-overflow-tooltip />
            <el-table-column prop="studentName" label="学生" width="120" show-overflow-tooltip />
            <el-table-column prop="questionTitle" label="题目" min-width="180" show-overflow-tooltip />
            <el-table-column prop="externalProblemId" label="Hydro" width="100" />
            <el-table-column prop="score" label="得分" width="80" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'judge_done' ? 'success' : 'warning'">
                  {{ hydroStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="showMediumColumns" label="最近提交" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.latestSubmission?.externalSubmissionId || row.latestSubmission?.submissionId || '-' }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="96">
              <template #default="{ row }">
                <el-button size="small" :disabled="!row.latestSubmission" @click="openHydroWriteback(row)">回写</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>

    <div class="panel library-table-panel stats-question-panel statistics-question-panel">
      <div class="section-head">
        <h2>题目分析</h2>
        <span class="muted">{{ selectedExamName || '点击上方考试查看题目正确率' }}</span>
      </div>
      <el-table :data="questionStats" height="100%" class="question-list-table">
        <el-table-column prop="title" label="题目" min-width="260" show-overflow-tooltip />
        <el-table-column prop="type" label="题型" width="120" />
        <el-table-column v-if="showMediumColumns" prop="difficulty" label="难度" width="90" />
        <el-table-column prop="answerCount" label="作答" width="90" />
        <el-table-column prop="correctRate" label="正确率" width="100">
          <template #default="{ row }">{{ percent(row.correctRate) }}</template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
      </el-table>
    </div>

    <div class="panel library-table-panel high-wrong-panel">
      <div class="section-head">
        <h2>高频错题</h2>
        <span class="muted">按班级、课程、时间和来源聚合</span>
      </div>
      <el-table :data="wrongQuestionStats" height="100%" class="question-list-table">
        <el-table-column prop="title" label="题目" min-width="260" show-overflow-tooltip />
        <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="140" show-overflow-tooltip />
        <el-table-column v-if="showMediumColumns" label="知识点" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ (row.knowledgePointNames || []).join('、') || '-' }}</template>
        </el-table-column>
        <el-table-column prop="wrongCount" label="错误频次" width="100" />
        <el-table-column prop="studentCount" label="涉及学生" width="100" />
        <el-table-column v-if="showMediumColumns" label="来源" min-width="160">
          <template #default="{ row }">
            <el-tag
              v-for="source in row.sourceSummary || []"
              :key="source.source"
              size="small"
              effect="plain"
              class="source-chip"
            >
              {{ sourceLabel(source.source) }} {{ source.count }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="showLowColumns" label="最近记录" width="160">
          <template #default="{ row }">{{ formatDate(row.latestAt) }}</template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="hydroWritebackVisible" title="Hydro 判题回写" width="520px" destroy-on-close>
      <el-form label-width="96px">
        <el-form-item label="提交">
          <span>{{ hydroWritebackForm.externalSubmissionId || hydroWritebackForm.submissionId || '-' }}</span>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="hydroWritebackForm.status" style="width: 100%">
            <el-option label="Accepted" value="accepted" />
            <el-option label="Wrong Answer" value="wrong_answer" />
            <el-option label="Compile Error" value="compile_error" />
            <el-option label="Runtime Error" value="runtime_error" />
            <el-option label="Time Limit" value="time_limit_exceeded" />
            <el-option label="System Error" value="system_error" />
          </el-select>
        </el-form-item>
        <el-form-item label="得分">
          <el-input-number v-model="hydroWritebackForm.score" :min="0" :step="1" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="hydroWritebackForm.message" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="hydroWritebackVisible = false">取消</el-button>
        <el-button type="primary" :loading="hydroWritebackSaving" @click="submitHydroWriteback">确认回写</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="reviewRulesVisible" title="错题复习提醒规则" size="720px" class="review-rule-drawer">
      <div class="review-rule-body">
        <el-alert
          type="info"
          show-icon
          :closable="false"
          title="规则可按课程、班级、知识点叠加；命中多条时优先使用知识点，其次班级，最后课程。"
        />
        <section class="review-rule-editor">
          <div class="section-head">
            <h2>{{ reviewRuleForm.id ? '编辑规则' : '新增规则' }}</h2>
            <el-button size="small" @click="resetReviewRuleForm">清空</el-button>
          </div>
          <el-form label-width="98px" class="review-rule-form">
            <el-form-item label="课程范围">
              <el-select
                v-model="reviewRuleForm.courseId"
                clearable
                filterable
                placeholder="全部课程"
                style="width: 100%"
                @change="handleReviewRuleCourseChange"
              >
                <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="班级范围">
              <el-select v-model="reviewRuleForm.classId" clearable filterable placeholder="全部班级" style="width: 100%">
                <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="知识点">
              <el-tree-select
                v-model="reviewRuleForm.knowledgePointId"
                :data="reviewKnowledgeTreeOptions"
                check-strictly
                clearable
                filterable
                :disabled="!reviewRuleForm.courseId"
                placeholder="不限知识点"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="规则模板">
              <el-segmented v-model="reviewRuleForm.preset" :options="reviewPresetOptions" @change="applyReviewPreset" />
            </el-form-item>
            <el-form-item label="间隔天数">
              <el-input v-model="reviewRuleForm.intervalsText" placeholder="例如：1,3,7,14,30" />
            </el-form-item>
            <el-form-item label="掌握规则" class="review-rule-wide">
              <div class="review-mastery-grid">
                <div class="review-mastery-item">
                  <el-input-number v-model="reviewRuleForm.correctStreak" :min="1" :max="20" />
                  <span class="muted">连续答对次数</span>
                </div>
                <div class="review-mastery-item">
                  <el-input-number v-model="reviewRuleForm.reviewingIntervalDays" :min="1" :max="365" />
                  <span class="muted">掌握前复习间隔</span>
                </div>
              </div>
            </el-form-item>
            <el-form-item label="启用">
              <el-switch v-model="reviewRuleForm.enabled" />
            </el-form-item>
            <el-form-item label="操作">
              <div class="toolbar">
                <el-button type="primary" :loading="reviewRuleSaving" @click="saveReviewRule">保存规则</el-button>
                <el-button @click="resetReviewRuleForm">重置</el-button>
              </div>
            </el-form-item>
          </el-form>
        </section>
        <section class="review-rule-list">
          <div class="section-head">
            <h2>已有规则</h2>
            <el-button :icon="Refresh" :loading="reviewRulesLoading" @click="loadReviewRules">刷新</el-button>
          </div>
          <el-table :data="reviewRules" height="100%" class="question-list-table compact-table">
            <el-table-column label="范围" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ reviewRuleScope(row) }}</template>
            </el-table-column>
            <el-table-column label="间隔" min-width="140" show-overflow-tooltip>
              <template #default="{ row }">{{ (row.intervalsDays || []).join(' / ') }} 天</template>
            </el-table-column>
            <el-table-column label="掌握" min-width="160" show-overflow-tooltip>
              <template #default="{ row }">
                连续 {{ row.masteryRule?.correctStreak || 3 }} 次，{{ row.masteryRule?.reviewingIntervalDays || 3 }} 天复习
              </template>
            </el-table-column>
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="150">
              <template #default="{ row }">
                <div class="question-actions">
                  <el-button size="small" @click="editReviewRule(row)">编辑</el-button>
                  <el-button size="small" type="danger" plain @click="deleteReviewRule(row)">删除</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
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
import StatisticsMetrics from './StatisticsMetrics.vue';
import { getKnowledgePointTree } from '../../questions/api';
import { getHydroSummary, writeBackHydroResult } from '../../hydro/api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import EChartPanel from '../../../components/EChartPanel.vue';

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
</script>

<style scoped>
.statistics-page {
  --statistics-panel-height: clamp(250px, 30vh, 340px);
}

.statistics-head {
  align-items: flex-start;
}

.statistics-toolbar {
  flex: 1 1 680px;
  justify-content: flex-end;
}

.statistics-toolbar > .el-select {
  flex: 0 1 220px;
}

.statistics-toolbar :deep(.el-date-editor) {
  flex: 0 1 280px;
  min-width: 220px;
}

.statistics-metric-row {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.statistics-insight-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  flex: 0 0 clamp(230px, 28vh, 330px);
  min-height: 230px;
}

.statistics-card {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.statistics-diagnostic-card {
  grid-column: span 1;
}

.compact-table :deep(.el-table__cell) {
  padding: 7px 0;
}

.statistics-detail-panel {
  flex: 0 0 var(--statistics-panel-height);
  min-height: 0;
  height: var(--statistics-panel-height);
}

.statistics-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.statistics-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}

.statistics-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.statistics-detail-panel :deep(.el-table__empty-block) {
  min-height: 140px;
}

.statistics-question-panel {
  flex: 1 1 260px;
  min-height: 260px;
}

.high-wrong-panel {
  flex: 1 1 300px;
  min-height: 300px;
}

.source-chip {
  margin-right: 6px;
  margin-bottom: 4px;
}

.review-rule-drawer :deep(.el-drawer__body) {
  min-height: 0;
  overflow: hidden;
}

.review-rule-body {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(260px, 1fr);
  gap: 14px;
}

.review-rule-editor,
.review-rule-list {
  min-width: 0;
}

.review-rule-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.review-rule-form .review-rule-wide,
.review-rule-form .el-form-item:nth-last-child(-n + 2) {
  grid-column: 1 / -1;
}

.review-mastery-grid {
  width: 100%;
  display: grid;
  grid-template-columns: repeat(2, minmax(220px, 1fr));
  gap: 10px 16px;
  align-items: center;
}

.review-mastery-item {
  min-width: 0;
  display: flex;
  gap: 10px;
  align-items: center;
}

.review-mastery-item :deep(.el-input-number) {
  flex: 0 0 120px;
  width: 120px;
}

.review-mastery-item .muted {
  min-width: 0;
  line-height: 1.4;
  white-space: normal;
}

.review-rule-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.review-rule-list > .el-table {
  flex: 1;
  min-height: 0;
}

@media (max-width: 1500px) {
  .statistics-insight-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    flex-basis: 520px;
  }

  .statistics-detail-panel {
    height: 300px;
  }

  .high-wrong-panel {
    min-height: 280px;
  }
}

@media (max-width: 980px) {
  .statistics-insight-grid {
    grid-template-columns: 1fr;
    flex: 0 0 auto;
  }

  .statistics-card {
    height: 280px;
  }

  .statistics-detail-panel {
    height: 300px;
  }

  .statistics-toolbar :deep(.el-date-editor),
  .statistics-toolbar > .el-select {
    flex: 1 1 100%;
  }
}

@media (max-width: 760px) {
  .review-rule-form {
    grid-template-columns: 1fr;
  }

  .review-mastery-grid {
    grid-template-columns: 1fr;
  }
}
</style>
