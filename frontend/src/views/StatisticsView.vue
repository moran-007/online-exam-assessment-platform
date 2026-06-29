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
      </div>
    </div>

    <div class="metric-row statistics-metric-row">
      <div class="metric">
        <span>提交次数</span>
        <strong>{{ overview.submittedAttempts }}</strong>
      </div>
      <div class="metric">
        <span>平均分</span>
        <strong>{{ overview.averageScore }}</strong>
      </div>
      <div class="metric">
        <span>最高分</span>
        <strong>{{ overview.maxScore }}</strong>
      </div>
      <div class="metric">
        <span>待批改</span>
        <strong>{{ overview.pendingManual }}</strong>
      </div>
      <div class="metric">
        <span>活跃错题</span>
        <strong>{{ overview.activeWrongQuestions }}</strong>
      </div>
      <div class="metric">
        <span>已批改</span>
        <strong>{{ overview.gradedCount }}</strong>
      </div>
    </div>

    <div class="analytics-grid statistics-grid">
      <div class="panel library-table-panel statistics-table-panel statistics-table-panel-main">
        <div class="section-head">
          <h2>考试表现</h2>
          <span class="muted">点击一行查看题目正确率</span>
        </div>
        <el-table :data="examStats" height="100%" class="question-list-table" @row-click="loadExamDetail">
          <el-table-column prop="examName" label="考试" min-width="180" show-overflow-tooltip />
          <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
          <el-table-column v-if="showLowColumns" prop="className" label="班级" width="130" show-overflow-tooltip />
          <el-table-column prop="submitCount" label="提交" width="80" />
          <el-table-column prop="averageScore" label="平均分" width="100" />
          <el-table-column v-if="showMediumColumns" prop="maxScore" label="最高" width="80" />
        </el-table>
      </div>
      <div class="panel library-table-panel statistics-table-panel">
        <div class="section-head">
          <h2>知识点表现</h2>
        </div>
        <el-table :data="knowledgeStats" height="100%" class="question-list-table">
          <el-table-column prop="name" label="知识点" min-width="180" show-overflow-tooltip />
          <el-table-column prop="answerCount" label="作答" width="80" />
          <el-table-column prop="correctRate" label="正确率" width="100">
            <template #default="{ row }">{{ percent(row.correctRate) }}</template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
        </el-table>
      </div>
      <div class="panel library-table-panel statistics-table-panel">
        <div class="section-head">
          <h2>班级概览</h2>
        </div>
        <el-table :data="classStats" height="100%" class="question-list-table">
          <el-table-column prop="className" label="班级" min-width="160" show-overflow-tooltip />
          <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="130" show-overflow-tooltip />
          <el-table-column prop="studentCount" label="学生" width="80" />
          <el-table-column prop="submitCount" label="提交" width="80" />
          <el-table-column v-if="showMediumColumns" prop="averageScore" label="平均分" width="100" />
        </el-table>
      </div>
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
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

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
const selectedExamName = ref('');
const { showMediumColumns, showLowColumns } = useResponsiveColumns();

async function load() {
  const query = statisticsQuery();
  const [coursePage, classPage, examPage, overviewData, examPageStats, knowledge, classData, wrongQuestions] = await Promise.all([
    api('/courses?pageSize=100'),
    api('/classes?pageSize=100'),
    api('/exams?pageSize=100&sortBy=createdAt&sortOrder=desc'),
    api(`/statistics/overview${query}`),
    api(`/statistics/exams${query}`),
    api(`/statistics/knowledge${query}`),
    api(`/statistics/classes${query}`),
    api(`/statistics/wrong-questions${query}`),
  ]);
  courses.value = coursePage.items;
  classes.value = classPage.items;
  exams.value = examPage.items;
  Object.assign(overview, overviewData);
  examStats.value = examPageStats.items;
  knowledgeStats.value = knowledge;
  classStats.value = classData;
  wrongQuestionStats.value = wrongQuestions;
  if (filter.examId) {
    await loadExamDetail({ examId: filter.examId });
  } else {
    questionStats.value = [];
    selectedExamName.value = '';
  }
}

function statisticsQuery() {
  return buildQuery({
    courseId: filter.courseId,
    classId: filter.classId,
    examId: filter.examId,
    sourceType: filter.sourceType,
    startDate: filter.dateRange?.[0],
    endDate: filter.dateRange?.[1],
  });
}

async function loadExamDetail(row) {
  const detail = await api(`/statistics/exams/${row.examId}`);
  questionStats.value = detail.questionStats;
  selectedExamName.value = detail.examName;
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
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

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

onMounted(load);
</script>

<style scoped>
.statistics-page {
  --statistics-panel-height: clamp(250px, 31vh, 360px);
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

.statistics-grid {
  grid-template-columns: minmax(380px, 1.35fr) minmax(300px, 1fr) minmax(300px, 1fr);
  align-items: stretch;
  flex: 0 0 var(--statistics-panel-height);
}

.statistics-table-panel {
  min-height: 0;
  height: var(--statistics-panel-height);
}

.statistics-table-panel :deep(.el-table__empty-block) {
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

@media (max-width: 1500px) {
  .statistics-grid {
    grid-template-columns: minmax(360px, 1.25fr) minmax(300px, 1fr);
    flex-basis: auto;
  }

  .statistics-table-panel {
    height: 300px;
  }

  .statistics-table-panel-main {
    grid-row: span 2;
    height: 614px;
  }

  .high-wrong-panel {
    min-height: 280px;
  }
}

@media (max-width: 980px) {
  .statistics-grid {
    grid-template-columns: 1fr;
  }

  .statistics-table-panel,
  .statistics-table-panel-main {
    height: 300px;
    grid-row: auto;
  }

  .statistics-toolbar :deep(.el-date-editor),
  .statistics-toolbar > .el-select {
    flex: 1 1 100%;
  }
}
</style>
