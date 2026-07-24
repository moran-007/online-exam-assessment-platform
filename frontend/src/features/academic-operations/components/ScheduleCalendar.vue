<template>
  <div class="schedule-calendar">
    <div class="calendar-controls">
      <el-radio-group v-model="view">
        <el-radio-button value="week">按周</el-radio-button>
        <el-radio-button value="day">按日</el-radio-button>
        <el-radio-button value="time">按时间段</el-radio-button>
      </el-radio-group>
      <el-date-picker v-if="view !== 'time'" v-model="anchor" type="date" value-format="YYYY-MM-DD" />
      <span class="muted">{{ visibleSessions.length }} 节课 · 已按开始时间排序</span>
    </div>
    <el-empty v-if="!groups.length" description="当前范围暂无课次" />
    <div v-else class="calendar-groups" data-testid="session-table">
      <section v-for="group in groups" :key="group.key" class="calendar-group">
        <header><strong>{{ group.label }}</strong><el-tag size="small">{{ group.items.length }} 节</el-tag></header>
        <div class="lesson-grid">
          <article v-for="row in group.items" :key="row.id" class="lesson-card" :class="`status-${row.status.toLowerCase()}`">
            <div class="lesson-time"><strong>{{ clock(row.startsAt) }}–{{ clock(row.endsAt) }}</strong><span>{{ dateLabel(row.startsAt) }}</span></div>
            <div class="lesson-main"><strong>{{ row.knowledgePoint?.name || row.title }}</strong><span>{{ row.classGroup?.name }} · {{ row.classGroup?.course?.name || '未关联课程' }}</span><span>{{ row.teacher?.realName || row.teacher?.username || '待安排' }} · {{ row.classroom || '未设置教室' }}</span></div>
            <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
            <div class="lesson-actions">
              <el-button v-if="canManageLessonRecords && row.status === 'PLANNED'" link type="primary" @click="$emit('record', row)">教学记录</el-button>
              <el-button v-if="canReadAttendance && row.status === 'PLANNED'" link type="primary" @click="$emit('attendance', row)">考勤</el-button>
              <template v-if="canManageSchedule">
                <el-button v-if="row.status === 'PLANNED'" link type="warning" @click="$emit('change', row, 'reschedule')">调课</el-button>
                <el-button v-if="row.status === 'PLANNED'" link type="danger" @click="$emit('cancel', row)">取消</el-button>
                <el-button v-if="['CANCELLED', 'RESCHEDULED'].includes(row.status)" link type="success" @click="$emit('change', row, 'makeup')">补课</el-button>
              </template>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AcademicOperationRecord } from '../api';

const props = defineProps<{ sessions: AcademicOperationRecord[]; canManageLessonRecords: boolean; canReadAttendance: boolean; canManageSchedule: boolean }>();
defineEmits<{ record: [row: AcademicOperationRecord]; attendance: [row: AcademicOperationRecord]; cancel: [row: AcademicOperationRecord]; change: [row: AcademicOperationRecord, mode: 'reschedule' | 'makeup'] }>();
const view = ref<'week' | 'day' | 'time'>('week');
const anchor = ref(new Date().toISOString().slice(0, 10));
const sorted = computed(() => [...props.sessions].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()));
const visibleSessions = computed(() => {
  if (view.value === 'time') return sorted.value;
  const selected = new Date(`${anchor.value}T00:00:00`);
  if (view.value === 'day') return sorted.value.filter((item) => sameDay(new Date(item.startsAt), selected));
  const start = startOfWeek(selected);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return sorted.value.filter((item) => { const date = new Date(item.startsAt); return date >= start && date < end; });
});
const groups = computed(() => {
  const map = new Map<string, AcademicOperationRecord[]>();
  for (const item of visibleSessions.value) {
    const date = new Date(item.startsAt);
    const key = view.value === 'time' ? timeBand(date) : date.toISOString().slice(0, 10);
    map.set(key, [...(map.get(key) || []), item]);
  }
  return [...map].map(([key, items]) => ({ key, items, label: view.value === 'time' ? key : dayHeading(items[0].startsAt) }));
});
function startOfWeek(date: Date) { const result = new Date(date); const day = result.getDay() || 7; result.setDate(result.getDate() - day + 1); result.setHours(0, 0, 0, 0); return result; }
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function timeBand(date: Date) { const hour = date.getHours(); return hour < 12 ? '上午（00:00–11:59）' : hour < 18 ? '下午（12:00–17:59）' : '晚上（18:00–23:59）'; }
function dayHeading(value: string) { return new Date(value).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); }
function dateLabel(value: string) { return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }); }
function clock(value: string) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function statusText(value: string) { return ({ PLANNED: '待上课', COMPLETED: '已完成', CANCELLED: '已取消', RESCHEDULED: '已调课' } as Record<string, string>)[value] || value; }
function statusType(value: string): 'success' | 'warning' | 'danger' | 'info' { return ({ COMPLETED: 'success', CANCELLED: 'danger', RESCHEDULED: 'warning' } as const)[value as 'COMPLETED'] || 'info'; }
</script>

<style scoped>
.schedule-calendar { height: calc(100% - 52px); min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.calendar-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.calendar-groups { min-height: 0; overflow: auto; display: grid; gap: 16px; padding-right: 4px; }
.calendar-group > header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 8px 0; background: var(--el-bg-color); }
.lesson-grid { display: grid; gap: 8px; }
.lesson-card { display: grid; grid-template-columns: 130px minmax(220px, 1fr) 82px auto; align-items: center; gap: 14px; padding: 12px 14px; border: 1px solid var(--el-border-color-lighter); border-left: 4px solid var(--el-color-primary); border-radius: 8px; background: var(--el-bg-color); }
.lesson-card.status-cancelled { border-left-color: var(--el-color-danger); opacity: .72; }
.lesson-card.status-rescheduled { border-left-color: var(--el-color-warning); }
.lesson-card.status-completed { border-left-color: var(--el-color-success); }
.lesson-time, .lesson-main { display: grid; gap: 4px; }
.lesson-time span, .lesson-main span { color: var(--el-text-color-secondary); font-size: 12px; }
.lesson-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; }
@media (max-width: 860px) { .lesson-card { grid-template-columns: 100px 1fr; } .lesson-actions { justify-content: flex-start; } }
</style>
