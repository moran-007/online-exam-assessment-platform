<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">看板</h1>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>
    <div class="metric-row">
      <div class="metric">
        <span>课程</span>
        <strong>{{ metrics.courses }}</strong>
      </div>
      <div class="metric">
        <span>题目</span>
        <strong>{{ metrics.questions }}</strong>
      </div>
      <div class="metric">
        <span>试卷</span>
        <strong>{{ metrics.papers }}</strong>
      </div>
      <div class="metric">
        <span>考试</span>
        <strong>{{ metrics.exams }}</strong>
      </div>
      <div class="metric">
        <span>班级</span>
        <strong>{{ metrics.classes }}</strong>
      </div>
      <div class="metric">
        <span>提交</span>
        <strong>{{ metrics.submittedAttempts }}</strong>
      </div>
      <div class="metric">
        <span>待批改</span>
        <strong>{{ metrics.pendingManual }}</strong>
      </div>
      <div class="metric">
        <span>活跃错题</span>
        <strong>{{ metrics.activeWrongQuestions }}</strong>
      </div>
    </div>
    <div class="panel">
      <el-table :data="exams" height="360">
        <el-table-column prop="examName" label="近期考试" min-width="180" />
        <el-table-column prop="courseName" label="课程" width="140" />
        <el-table-column prop="className" label="范围" width="120" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="submitCount" label="提交" width="80" />
        <el-table-column prop="averageScore" label="平均分" width="100" />
        <el-table-column prop="maxScore" label="最高分" width="100" />
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api } from '../api';

const metrics = reactive({
  courses: 0,
  questions: 0,
  papers: 0,
  exams: 0,
  classes: 0,
  submittedAttempts: 0,
  pendingManual: 0,
  activeWrongQuestions: 0,
});
const exams = ref([]);

async function load() {
  const [overview, examStats] = await Promise.all([
    api('/statistics/overview'),
    api('/statistics/exams?pageSize=10'),
  ]);
  Object.assign(metrics, overview);
  exams.value = examStats.items;
}

onMounted(load);
</script>
