<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">统计分析</h1>
      <div class="toolbar">
        <el-select v-model="filter.courseId" clearable filterable placeholder="课程" @change="load">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-select v-model="filter.classId" clearable filterable placeholder="班级" @change="load">
          <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-select v-model="filter.examId" clearable filterable placeholder="考试" @change="load">
          <el-option v-for="exam in exams" :key="exam.id" :label="exam.name" :value="exam.id" />
        </el-select>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </div>

    <div class="metric-row">
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

    <div class="analytics-grid">
      <div class="panel library-table-panel">
        <div class="section-head">
          <h2>考试表现</h2>
        </div>
        <el-table :data="examStats" height="100%" class="question-list-table" @row-click="loadExamDetail">
          <el-table-column prop="examName" label="考试" min-width="180" show-overflow-tooltip />
          <el-table-column prop="courseName" label="课程" width="130" />
          <el-table-column prop="className" label="班级" width="130" />
          <el-table-column prop="submitCount" label="提交" width="80" />
          <el-table-column prop="averageScore" label="平均分" width="100" />
          <el-table-column prop="maxScore" label="最高" width="80" />
        </el-table>
      </div>
      <div class="panel library-table-panel">
        <div class="section-head">
          <h2>知识点表现</h2>
        </div>
        <el-table :data="knowledgeStats" height="100%" class="question-list-table">
          <el-table-column prop="name" label="知识点" min-width="180" show-overflow-tooltip />
          <el-table-column prop="answerCount" label="作答" width="80" />
          <el-table-column prop="correctRate" label="正确率" width="100">
            <template #default="{ row }">{{ percent(row.correctRate) }}</template>
          </el-table-column>
          <el-table-column prop="averageScore" label="平均分" width="100" />
        </el-table>
      </div>
      <div class="panel library-table-panel">
        <div class="section-head">
          <h2>班级概览</h2>
        </div>
        <el-table :data="classStats" height="100%" class="question-list-table">
          <el-table-column prop="className" label="班级" min-width="160" show-overflow-tooltip />
          <el-table-column prop="courseName" label="课程" width="130" />
          <el-table-column prop="studentCount" label="学生" width="80" />
          <el-table-column prop="submitCount" label="提交" width="80" />
          <el-table-column prop="averageScore" label="平均分" width="100" />
        </el-table>
      </div>
    </div>

    <div class="panel library-table-panel stats-question-panel">
      <div class="section-head">
        <h2>题目分析</h2>
        <span class="muted">{{ selectedExamName || '点击上方考试查看题目正确率' }}</span>
      </div>
      <el-table :data="questionStats" height="100%" class="question-list-table">
        <el-table-column prop="title" label="题目" min-width="260" show-overflow-tooltip />
        <el-table-column prop="type" label="题型" width="120" />
        <el-table-column prop="difficulty" label="难度" width="90" />
        <el-table-column prop="answerCount" label="作答" width="90" />
        <el-table-column prop="correctRate" label="正确率" width="100">
          <template #default="{ row }">{{ percent(row.correctRate) }}</template>
        </el-table-column>
        <el-table-column prop="averageScore" label="平均分" width="100" />
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';

const filter = reactive({ courseId: '', classId: '', examId: '' });
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
const selectedExamName = ref('');

async function load() {
  const query = buildQuery(filter);
  const [coursePage, classPage, examPage, overviewData, examPageStats, knowledge, classData] = await Promise.all([
    api('/courses?pageSize=100'),
    api('/classes?pageSize=100'),
    api('/exams?pageSize=100&sortBy=createdAt&sortOrder=desc'),
    api(`/statistics/overview${query}`),
    api(`/statistics/exams${query}`),
    api(`/statistics/knowledge${query}`),
    api(`/statistics/classes${query}`),
  ]);
  courses.value = coursePage.items;
  classes.value = classPage.items;
  exams.value = examPage.items;
  Object.assign(overview, overviewData);
  examStats.value = examPageStats.items;
  knowledgeStats.value = knowledge;
  classStats.value = classData;
  if (filter.examId) {
    await loadExamDetail({ examId: filter.examId });
  } else {
    questionStats.value = [];
    selectedExamName.value = '';
  }
}

async function loadExamDetail(row) {
  const detail = await api(`/statistics/exams/${row.examId}`);
  questionStats.value = detail.questionStats;
  selectedExamName.value = detail.examName;
}

function percent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

onMounted(load);
</script>
