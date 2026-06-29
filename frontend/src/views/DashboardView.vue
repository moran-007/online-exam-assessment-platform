<template>
  <div class="page dashboard-page">
    <div class="page-head">
      <h1 class="page-title">看板</h1>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>
    <div class="metric-row dashboard-metric-row">
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
    <div class="dashboard-grid">
      <div class="panel library-table-panel dashboard-main-panel">
        <div class="section-head">
          <div>
            <h2>近期考试</h2>
            <span class="muted">按最新统计更新，优先关注提交与待批改情况。</span>
          </div>
        </div>
        <el-table :data="exams" height="100%" class="question-list-table">
          <el-table-column prop="examName" label="考试" min-width="200" show-overflow-tooltip />
          <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="140" show-overflow-tooltip />
          <el-table-column v-if="showLowColumns" prop="className" label="范围" width="130" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="submitCount" label="提交" width="80" />
          <el-table-column prop="averageScore" label="平均分" width="100" />
          <el-table-column v-if="showMediumColumns" prop="maxScore" label="最高分" width="100" />
        </el-table>
      </div>
      <aside class="dashboard-side">
        <section class="panel dashboard-summary-panel">
          <div class="section-head">
            <h2>今日概览</h2>
          </div>
          <div class="insight-list">
            <div class="insight-item">
              <span>待处理主观题</span>
              <strong>{{ metrics.pendingManual }}</strong>
            </div>
            <div class="insight-item">
              <span>活跃错题</span>
              <strong>{{ metrics.activeWrongQuestions }}</strong>
            </div>
            <div class="insight-item">
              <span>已提交记录</span>
              <strong>{{ metrics.submittedAttempts }}</strong>
            </div>
          </div>
        </section>
        <section class="panel dashboard-summary-panel">
          <div class="section-head">
            <h2>维护建议</h2>
          </div>
          <div class="todo-list">
            <div v-for="item in todoItems" :key="item" class="todo-item">{{ item }}</div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api } from '../api';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

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
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const todoItems = computed(() => {
  const items = [];
  if (metrics.pendingManual > 0) items.push(`有 ${metrics.pendingManual} 条主观题记录待批改`);
  if (metrics.activeWrongQuestions > 0) items.push(`错题本中仍有 ${metrics.activeWrongQuestions} 条活跃错题`);
  if (!metrics.questions) items.push('题库暂无题目，可以先导入基础题目');
  if (!metrics.exams) items.push('暂无考试，可以从试卷库创建考试');
  return items.length ? items : ['当前数据状态稳定，可以继续维护题库与考试安排'];
});

async function load() {
  const [overview, examStats] = await Promise.all([
    api('/statistics/overview'),
    api('/statistics/exams?pageSize=10'),
  ]);
  Object.assign(metrics, overview);
  exams.value = examStats.items;
}

onMounted(load);

function statusLabel(value) {
  const map = { draft: '草稿', scheduled: '已安排', running: '进行中', ended: '已结束', archived: '已归档' };
  return map[value] ?? value;
}

function statusType(value) {
  if (value === 'running') return 'success';
  if (value === 'ended' || value === 'archived') return 'info';
  if (value === 'draft') return 'warning';
  return 'primary';
}
</script>

<style scoped>
.dashboard-page {
  --dashboard-panel-height: clamp(360px, 48vh, 560px);
}

.dashboard-metric-row {
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
}

.dashboard-main-panel {
  height: var(--dashboard-panel-height);
  min-height: 0;
}

.dashboard-side {
  display: grid;
  gap: 14px;
  align-content: start;
  min-width: 0;
}

.dashboard-summary-panel {
  display: grid;
  gap: 12px;
}

.insight-list,
.todo-list {
  display: grid;
  gap: 10px;
}

.insight-item,
.todo-item {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: #f8fafc;
}

.insight-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.insight-item span,
.todo-item {
  color: #4b5563;
  overflow-wrap: anywhere;
}

.insight-item strong {
  flex: 0 0 auto;
  font-size: 22px;
  color: #111827;
}

@media (max-width: 1280px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-side {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .dashboard-side {
    grid-template-columns: 1fr;
  }
}
</style>
