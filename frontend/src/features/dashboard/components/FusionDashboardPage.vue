<template>
  <div v-loading="loading" class="page fusion-dashboard">
    <div class="page-head">
      <div>
        <h1 class="page-title">测评 · 教务融合看板</h1>
        <span class="muted">{{ dashboard.scopeLabel }} · {{ rangeLabel }}</span>
      </div>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="metric-row fusion-metrics">
      <div v-for="card in cards" :key="card.label" class="metric">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
      </div>
    </div>

    <div class="fusion-grid">
      <section class="panel fusion-main">
        <div class="section-head">
          <div>
            <h2>近期考试</h2>
            <span class="muted">只展示当前账号数据范围内的提交。</span>
          </div>
        </div>
        <el-table :data="dashboard.recentExams" height="100%">
          <el-table-column prop="examName" label="考试" min-width="180" show-overflow-tooltip />
          <el-table-column prop="courseName" label="课程" min-width="120" show-overflow-tooltip />
          <el-table-column prop="submitCount" label="提交" width="80" />
          <el-table-column prop="gradedCount" label="评分" width="80" />
          <el-table-column prop="averageScore" label="平均分" width="100" />
        </el-table>
      </section>

      <aside class="fusion-side">
        <section class="panel">
          <div class="section-head"><h2>教务实况</h2></div>
          <div class="fact-list">
            <Fact label="教学记录已发布" :value="dashboard.academic.publishedLessonRecords" />
            <Fact label="已确认考勤" :value="dashboard.academic.confirmedAttendance" />
            <Fact label="缺勤" :value="dashboard.academic.absentCount" />
            <Fact label="已消耗课时" :value="dashboard.academic.consumedLessonHours.toFixed(2)" />
            <Fact label="排课课时" :value="dashboard.academic.assignedLessonHours.toFixed(2)" />
          </div>
        </section>
        <section class="panel">
          <div class="section-head"><h2>快速下钻</h2></div>
          <div class="drilldowns">
            <router-link v-for="item in dashboard.drilldowns" :key="item.metric" :to="item.path">
              {{ item.label }}
              <small>{{ item.source }}</small>
            </router-link>
          </div>
        </section>
      </aside>
    </div>

    <section v-if="dashboard.teacherPerformance.length" class="panel">
      <div class="section-head">
        <div><h2>教师课次业绩</h2><span class="muted">按当前查询范围聚合。</span></div>
      </div>
      <el-table :data="dashboard.teacherPerformance">
        <el-table-column prop="teacherName" label="教师" min-width="140" />
        <el-table-column prop="scheduledLessons" label="计划课次" width="100" />
        <el-table-column prop="completedLessons" label="完成课次" width="100" />
        <el-table-column prop="completedHours" label="完成课时" width="100" />
        <el-table-column prop="publishedLessonRecords" label="发布记录" width="100" />
        <el-table-column prop="confirmedAttendance" label="确认考勤" width="100" />
      </el-table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import Fact from './FusionDashboardFact.vue';
import { useFusionDashboard } from '../composables/useFusionDashboard';

const { loading, dashboard, cards, rangeLabel, load } = useFusionDashboard();
</script>

<style scoped>
.fusion-metrics { grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); }
.fusion-grid { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 14px; min-height: 420px; }
.fusion-main { min-height: 420px; }
.fusion-side, .fact-list, .drilldowns { display: grid; gap: 12px; align-content: start; }
.drilldowns a { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; color: var(--el-color-primary); }
.drilldowns small { color: var(--muted); }
@media (max-width: 1000px) { .fusion-grid { grid-template-columns: 1fr; } }
</style>
