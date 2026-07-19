<template>
  <div class="page learning-portal-page">
    <section class="page-head">
      <div><h2 class="page-title">学习门户</h2><p class="muted">只展示教师已发布的课次内容、考试结果和总结。</p></div>
      <div class="toolbar">
        <el-select v-if="students.length > 1" v-model="selectedStudentId" style="width: 220px" @change="loadOverview">
          <el-option v-for="item in students" :key="item.student.id" :label="studentName(item.student)" :value="item.student.id" />
        </el-select>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </section>

    <el-empty v-if="!students.length && !loading" description="暂无可查看的关联学生" />
    <template v-else-if="overview">
      <section class="panel portal-summary">
        <el-descriptions :column="4" border>
          <el-descriptions-item label="学生">{{ studentName(overview.student) }}</el-descriptions-item>
          <el-descriptions-item label="学号">{{ overview.student.studentProfile?.studentNo || '-' }}</el-descriptions-item>
          <el-descriptions-item label="学校/年级">{{ [overview.student.studentProfile?.school, overview.student.studentProfile?.grade].filter(Boolean).join(' · ') || '-' }}</el-descriptions-item>
          <el-descriptions-item label="班级">{{ overview.student.studentClasses?.map((item) => item.classGroup.name).join('、') || '-' }}</el-descriptions-item>
        </el-descriptions>
      </section>

      <section v-loading="loading" class="panel portal-content">
        <el-tabs>
          <el-tab-pane label="课次学习">
            <el-table :data="overview.lessons.items" height="100%" data-testid="portal-lessons">
              <el-table-column label="时间" width="190"><template #default="{ row }">{{ formatTime(row.startsAt) }}</template></el-table-column>
              <el-table-column prop="classGroup.name" label="班级" min-width="150" />
              <el-table-column label="课次" min-width="240"><template #default="{ row }"><strong>{{ row.title }}</strong><div class="muted">{{ row.lessonType.name }}</div></template></el-table-column>
              <el-table-column label="已发布内容" min-width="260"><template #default="{ row }"><span v-if="row.record">{{ row.record.publicTeachingContent || '教师已发布课件' }}</span><span v-else class="muted">暂未发布学习内容</span></template></el-table-column>
              <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button v-if="row.record" data-testid="open-portal-lesson" link type="primary" @click="openLesson(row)">查看详情</el-button></template></el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="考试记录">
            <el-table :data="overview.exams" height="100%" data-testid="portal-exams">
              <el-table-column prop="name" label="考试" min-width="220" />
              <el-table-column prop="courseName" label="课程" min-width="160" />
              <el-table-column label="提交时间" width="190"><template #default="{ row }">{{ formatTime(row.submittedAt) }}</template></el-table-column>
              <el-table-column label="成绩" width="120"><template #default="{ row }"><strong v-if="row.score !== null">{{ row.score }}</strong><span v-else class="muted">暂未开放</span></template></el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="已发布总结">
            <div v-if="overview.summaries.length" class="summary-list" data-testid="portal-summaries">
              <article v-for="item in overview.summaries" :key="item.id" class="summary-card">
                <div class="summary-head"><el-tag>{{ summaryType(item.type) }}</el-tag><span class="muted">{{ formatTime(item.publishedAt) }}</span></div>
                <dl><template v-for="entry in summaryEntries(item.content)" :key="entry[0]"><dt>{{ entry[0] }}</dt><dd>{{ entry[1] }}</dd></template></dl>
              </article>
            </div>
            <el-empty v-else description="暂无教师已发布的总结" />
          </el-tab-pane>
        </el-tabs>
      </section>
    </template>

    <el-drawer v-model="lessonVisible" size="min(760px, 96vw)" title="课次学习详情">
      <template v-if="selectedLesson?.record">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="本节课内容">{{ selectedLesson.record.publicTeachingContent || '-' }}</el-descriptions-item>
          <el-descriptions-item label="学习目标">{{ selectedLesson.record.publicLearningGoal || '-' }}</el-descriptions-item>
          <el-descriptions-item label="课堂表现">{{ selectedLesson.record.publicClassPerformance || '-' }}</el-descriptions-item>
          <el-descriptions-item label="课后作业">{{ selectedLesson.record.publicHomework || '-' }}</el-descriptions-item>
          <el-descriptions-item label="下次计划">{{ selectedLesson.record.publicNextPlan || '-' }}</el-descriptions-item>
          <el-descriptions-item label="材料说明">{{ selectedLesson.record.publicMaterials || '-' }}</el-descriptions-item>
        </el-descriptions>
        <h3>课次附件</h3>
        <el-empty v-if="!selectedLesson.record.assets.length" description="本课次暂无公开附件" :image-size="72" />
        <el-table v-else :data="selectedLesson.record.assets" data-testid="portal-assets">
          <el-table-column label="附件"><template #default="{ row }">{{ row.title || row.fileName }}</template></el-table-column>
          <el-table-column label="操作" width="150"><template #default="{ row }"><el-button link type="primary" @click="openAssetRow(row)">预览</el-button><el-button link type="primary" @click="downloadAssetRow(row)">下载</el-button></template></el-table-column>
        </el-table>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import {
  getPortalOverview,
  listPortalStudents,
  openLessonAsset,
  type LessonAssetView,
  type PortalLesson,
  type PortalOverview,
  type PortalStudent,
  type PortalStudentRelation,
} from '../api';

const loading = ref(false);
const students = ref<PortalStudentRelation[]>([]);
const selectedStudentId = ref('');
const overview = ref<PortalOverview | null>(null);
const lessonVisible = ref(false);
const selectedLesson = ref<PortalLesson | null>(null);

async function load() {
  loading.value = true;
  try {
    students.value = await listPortalStudents();
    if (!students.value.some((item) => item.student.id === selectedStudentId.value)) {
      selectedStudentId.value = students.value[0]?.student.id || '';
    }
    await loadOverview();
  } finally {
    loading.value = false;
  }
}

async function loadOverview() {
  if (!selectedStudentId.value) {
    overview.value = null;
    return;
  }
  overview.value = await getPortalOverview(selectedStudentId.value);
}

function openLesson(row: unknown) {
  selectedLesson.value = row as PortalLesson;
  lessonVisible.value = true;
}

function openAsset(asset: LessonAssetView, download = false) {
  if (!selectedLesson.value) return Promise.resolve();
  return openLessonAsset(selectedLesson.value.id, asset, { studentId: selectedStudentId.value, download });
}
const openAssetRow = (row: unknown) => openAsset(row as LessonAssetView);
const downloadAssetRow = (row: unknown) => openAsset(row as LessonAssetView, true);

const studentName = (student: PortalStudent) => student.realName || student.username;
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const summaryType = (value: string) => ({ student: '学生总结', exam: '考试总结', parent_report: '家长报告' }[value] || value);
const summaryEntries = (content: unknown): Array<[string, string]> => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return [['内容', String(content || '-')]];
  return Object.entries(content as Record<string, unknown>)
    .filter(([key]) => key !== 'schemaVersion')
    .map(([key, value]) => [key, Array.isArray(value) ? value.join('；') : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '-')]);
};

onMounted(load);
</script>

<style scoped>
.learning-portal-page { min-height: 0; }
.portal-summary { flex: 0 0 auto; }
.portal-content { flex: 1; min-height: 460px; overflow: hidden; }
.portal-content :deep(.el-tabs), .portal-content :deep(.el-tabs__content), .portal-content :deep(.el-tab-pane) { height: 100%; }
.summary-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; overflow: auto; max-height: 100%; }
.summary-card { border: 1px solid var(--el-border-color); border-radius: 10px; padding: 16px; }
.summary-head { display: flex; justify-content: space-between; align-items: center; }
.summary-card dl { margin-bottom: 0; }
.summary-card dt { color: var(--el-text-color-secondary); margin-top: 12px; }
.summary-card dd { margin: 4px 0 0; white-space: pre-wrap; }
</style>
