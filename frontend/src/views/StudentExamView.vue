<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">我的考试</h1>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="load">刷新</el-button>
      </div>
    </div>
    <el-tabs v-model="examTab" class="page-tabs" @tab-change="load">
      <el-tab-pane label="进行中" name="running" />
      <el-tab-pane label="即将开始" name="scheduled" />
      <el-tab-pane label="考试历史" name="ended" />
    </el-tabs>
    <div class="panel library-table-panel student-exam-table-panel">
      <el-table
        :data="items"
        height="100%"
        highlight-current-row
        :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
        @row-click="openRow"
        @sort-change="handleStudentExamSortChange"
      >
        <el-table-column type="expand" width="46">
          <template #default="{ row }">
            <el-table :data="row.attempts || []" size="small">
              <el-table-column prop="attemptNo" label="次数" width="80" />
              <el-table-column prop="status" label="状态" width="120">
                <template #default="{ row: attempt }">
                  <el-tag :type="statusTagType('attempt', attempt.status)" effect="plain">
                    {{ statusLabel('attempt', attempt.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="totalScore" label="分数" width="90" />
              <el-table-column prop="submittedAt" label="提交时间" min-width="180" />
              <el-table-column label="操作" width="100">
                <template #default="{ row: attempt }">
                  <el-button v-if="attempt.attemptId && attempt.status !== 'in_progress'" size="small" @click.stop="result({ attemptId: attempt.attemptId })">
                    成绩
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="考试" min-width="180" sortable="custom" />
        <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="140" />
        <el-table-column prop="status" label="状态" width="110" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="statusTagType('exam', row.status)" effect="plain">
              {{ statusLabel('exam', row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="showLowColumns" prop="startTime" label="开始时间" width="170" sortable="custom">
          <template #default="{ row }">{{ formatDateTime(row.startTime) }}</template>
        </el-table-column>
        <el-table-column v-if="showLowColumns" prop="endTime" label="结束时间" width="170" sortable="custom">
          <template #default="{ row }">{{ formatDateTime(row.endTime) }}</template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" label="时间提醒" min-width="180">
          <template #default="{ row }">
            <el-tag :type="timeTagType(row)" effect="plain">{{ examTimeHint(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="attemptStatus" label="作答" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType('attempt', row.attemptStatus)" effect="plain">
              {{ statusLabel('attempt', row.attemptStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="次数" width="120">
          <template #default="{ row }">
            {{ row.attemptUsedCount || 0 }} / {{ row.attemptLimit || 1 }}
          </template>
        </el-table-column>
        <el-table-column v-if="showMediumColumns" prop="durationMinutes" label="时长" width="90" sortable="custom" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <div class="question-actions row-action-cell" @click.stop @mousedown.stop>
              <el-dropdown trigger="click" @command="(command) => handleStudentExamCommand(row, command)">
                <el-button size="small" @click.stop>操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="enter" :disabled="!canEnter(row)">{{ enterText(row) }}</el-dropdown-item>
                    <el-dropdown-item command="result" :disabled="!row.attemptId || row.attemptStatus === 'in_progress'">成绩</el-dropdown-item>
                    <el-dropdown-item command="ranking">排名</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="announcementVisible" title="考试公告" width="560px">
      <MarkdownRenderer :source="selectedExam?.announcement || ''" />
      <el-checkbox v-model="announcementRead">我已阅读并理解考试公告</el-checkbox>
      <template #footer>
        <el-button @click="announcementVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!announcementRead" @click="confirmEnter">进入考试</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="rankingVisible" :title="rankingTitle" size="680px" destroy-on-close>
      <el-alert
        v-if="rankingData?.myRank"
        :title="`我的当前排名：第 ${rankingData.myRank} 名`"
        type="success"
        show-icon
        :closable="false"
        class="batch-alert"
      />
      <el-table :data="rankingData?.items || []" height="520" :row-class-name="rankingRowClass">
        <el-table-column prop="rank" label="排名" width="80" />
        <el-table-column prop="studentName" label="学生" min-width="140" />
        <el-table-column prop="username" label="账号" width="120" />
        <el-table-column prop="attemptNo" label="第几次" width="80" />
        <el-table-column prop="totalScore" label="总分" width="90" />
        <el-table-column prop="objectiveScore" label="客观题" width="90" />
        <el-table-column prop="submittedAt" label="提交时间" min-width="170" />
      </el-table>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { DataAnalysis, Refresh } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';
import { statusLabel, statusTagType } from '../statusMeta';

const router = useRouter();
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const items = ref([]);
const filter = reactive({ sortBy: 'startTime', sortOrder: 'desc' });
const examTab = ref('running');
const announcementVisible = ref(false);
const announcementRead = ref(false);
const selectedExam = ref(null);
const rankingVisible = ref(false);
const rankingData = ref(null);
const nowTime = ref(Date.now());
let timer = null;
const rankingTitle = computed(() => (rankingData.value ? `排名：${rankingData.value.examName}` : '排名'));

async function load() {
  items.value = await api(`/student/exams${buildQuery({ ...filter, status: examTab.value })}`);
}

function handleStudentExamSortChange({ prop, order }) {
  filter.sortBy = prop || 'startTime';
  filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return load();
}

function enter(row) {
  if (row.announcement && !row.announcementReadAt) {
    selectedExam.value = row;
    announcementRead.value = false;
    announcementVisible.value = true;
    return;
  }
  router.push(`/student/exams/${row.examId}`);
}

function result(row) {
  router.push(`/student/attempts/${row.attemptId}/result`);
}

function handleStudentExamCommand(row, command) {
  if (command === 'enter' && canEnter(row)) return enter(row);
  if (command === 'result' && row.attemptId && row.attemptStatus !== 'in_progress') return result(row);
  if (command === 'ranking') return openRanking(row);
}

async function openRanking(row) {
  rankingData.value = await api(`/student/exams/${row.examId}/ranking`);
  rankingVisible.value = true;
}

function rankingRowClass({ row }) {
  return row.isCurrentUser ? 'student-ranking-current' : '';
}

function openRow(row) {
  if (canEnter(row)) {
    enter(row);
    return;
  }
  if (row.attemptId && row.attemptStatus !== 'in_progress') {
    result(row);
    return;
  }
}

function canEnter(row) {
  if (row.status !== 'running') return false;
  if (row.attemptStatus === 'in_progress') return true;
  return Number(row.remainingAttemptCount ?? 0) > 0;
}

function examTimeHint(row) {
  const now = nowTime.value;
  const start = new Date(row.startTime).getTime();
  const end = new Date(row.endTime).getTime();

  if (now < start) {
    return `距开始 ${formatDuration(start - now)}`;
  }
  if (now < end) {
    return `距结束 ${formatDuration(end - now)}`;
  }
  return '已结束';
}

function timeTagType(row) {
  const now = nowTime.value;
  const start = new Date(row.startTime).getTime();
  const end = new Date(row.endTime).getTime();
  if (now < start) return 'info';
  if (now < end && end - now <= 10 * 60 * 1000) return 'danger';
  if (now < end) return 'warning';
  return 'info';
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}时${minutes}分`;
  return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function enterText(row) {
  if (row.attemptStatus === 'in_progress') return '继续作答';
  if ((row.attemptUsedCount ?? 0) > 0) return '再次作答';
  return '进入';
}

async function confirmEnter() {
  if (!selectedExam.value) return;
  try {
    const record = await api(`/student/exams/${selectedExam.value.examId}/announcement/read`, { method: 'POST' });
    selectedExam.value.announcementReadAt = record.readAt || new Date().toISOString();
    selectedExam.value.announcementRead = true;
    announcementVisible.value = false;
    router.push(`/student/exams/${selectedExam.value.examId}`);
  } catch (error) {
    ElMessage.error(error.message || '公告阅读记录保存失败');
  }
}

onMounted(() => {
  load();
  timer = window.setInterval(() => {
    nowTime.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (timer) window.clearInterval(timer);
});
</script>
