<template>
  <div v-loading="loading" class="page fusion-dashboard">
    <div class="page-head">
      <div>
        <h1 class="page-title">测评 · 教务融合看板</h1>
        <p class="page-subtitle">{{ dashboard.scopeLabel }} · {{ rangeLabel }}</p>
      </div>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="metric-row fusion-metrics">
      <div v-for="card in cards" :key="card.label" class="metric">
        <span class="metric-label">{{ card.label }}</span>
        <div class="metric-value"><strong>{{ card.value }}</strong></div>
      </div>
    </div>

    <div class="fusion-grid">
      <section class="panel fusion-main">
        <div class="section-head">
          <div>
            <h2>近期考试</h2>
            <span class="section-note">当前账号数据范围内的最近提交</span>
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
          <div class="section-head"><div><h2>教务实况</h2><span class="section-note">本期教学概况</span></div></div>
          <div class="fact-list">
            <Fact label="教学记录已发布" :value="dashboard.academic.publishedLessonRecords" />
            <Fact label="已确认考勤" :value="dashboard.academic.confirmedAttendance" />
            <Fact label="缺勤" :value="dashboard.academic.absentCount" />
            <Fact label="已消耗课时" :value="dashboard.academic.consumedLessonHours.toFixed(2)" />
            <Fact label="排课课时" :value="dashboard.academic.assignedLessonHours.toFixed(2)" />
          </div>
        </section>
        <section class="panel">
          <div class="section-head"><div><h2>快速下钻</h2><span class="section-note">常用数据入口</span></div></div>
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
        <div><h2>教师课次业绩</h2><span class="section-note">按当前查询范围聚合</span></div>
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
.fusion-dashboard { gap: 16px; }
.fusion-dashboard .page-head { min-height: 46px; }
.page-subtitle { margin: 7px 0 0; color: var(--muted); font-size: 13px; }
.fusion-metrics { grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; }
.fusion-metrics .metric { position: relative; min-height: 102px; overflow: hidden; padding: 18px 20px; }
.fusion-metrics .metric::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--el-color-primary); opacity: .9; }
.fusion-metrics .metric:nth-child(2n)::before,
.fusion-metrics .metric:nth-child(6)::before,
.fusion-metrics .metric:nth-child(7)::before { background: var(--accent); }
.metric-label { color: var(--muted); font-size: 13px; font-weight: 500; }
.metric-value { display: flex; align-items: flex-end; gap: 6px; margin-top: 9px; }
.metric-value strong { margin: 0; color: var(--text); font-size: 28px; line-height: 1; letter-spacing: -.02em; }
.fusion-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 14px; min-height: 400px; }
.fusion-main { min-height: 400px; display: flex; flex-direction: column; }
.fusion-main :deep(.el-table) { flex: 1; }
.fusion-side, .fact-list, .drilldowns { display: grid; gap: 10px; align-content: start; }
.fusion-side { grid-template-rows: auto 1fr; gap: 14px; }
.section-note { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 400; }
.drilldowns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.drilldowns a { display: grid; gap: 4px; min-height: 64px; padding: 11px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text); background: var(--panel-subtle); font-size: 13px; font-weight: 600; transition: border-color .16s ease, background-color .16s ease, color .16s ease; }
.drilldowns a:hover { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.drilldowns small { color: var(--muted); font-size: 11px; font-weight: 400; }
@media (max-width: 1200px) { .fusion-metrics { grid-template-columns: repeat(2, minmax(150px, 1fr)); } }
@media (max-width: 1000px) { .fusion-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .fusion-metrics { grid-template-columns: 1fr; } .drilldowns { grid-template-columns: 1fr; } }
</style>
