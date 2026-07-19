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
        <el-tabs v-model="activeTab">
          <el-tab-pane label="课次学习" name="lessons">
            <el-table :data="overview.lessons.items" height="100%" data-testid="portal-lessons">
              <el-table-column label="时间" width="190"><template #default="{ row }">{{ formatTime(row.startsAt) }}</template></el-table-column>
              <el-table-column prop="classGroup.name" label="班级" min-width="150" />
              <el-table-column label="课次" min-width="240"><template #default="{ row }"><strong>{{ row.title }}</strong><div class="muted">{{ row.lessonType.name }}</div></template></el-table-column>
              <el-table-column label="已发布内容" min-width="260"><template #default="{ row }"><span v-if="row.record">{{ row.record.publicTeachingContent || '教师已发布课件' }}</span><span v-else class="muted">暂未发布学习内容</span></template></el-table-column>
              <el-table-column label="操作" width="110" fixed="right"><template #default="{ row }"><el-button v-if="row.record" data-testid="open-portal-lesson" link type="primary" @click="openLesson(row)">查看详情</el-button></template></el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="考试记录" name="exams">
            <el-table :data="overview.exams" height="100%" data-testid="portal-exams">
              <el-table-column prop="name" label="考试" min-width="220" />
              <el-table-column prop="courseName" label="课程" min-width="160" />
              <el-table-column label="提交时间" width="190"><template #default="{ row }">{{ formatTime(row.submittedAt) }}</template></el-table-column>
              <el-table-column label="成绩" width="120"><template #default="{ row }"><strong v-if="row.score !== null">{{ row.score }}</strong><span v-else class="muted">暂未开放</span></template></el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="已发布总结" name="summaries">
            <div v-if="overview.summaries.length" class="summary-list" data-testid="portal-summaries">
              <article v-for="item in overview.summaries" :key="item.id" class="summary-card">
                <div class="summary-head">
                  <el-tag>{{ summaryType(item.type) }}</el-tag>
                  <span class="muted">{{ formatTime(item.publishedAt) }}</span>
                </div>
                <dl><template v-for="entry in summaryEntries(item.content)" :key="entry[0]"><dt>{{ entry[0] }}</dt><dd>{{ entry[1] }}</dd></template></dl>
                <el-button size="small" type="primary" plain @click="openFeedback(item)">评价这份总结</el-button>
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

    <el-dialog v-model="feedbackVisible" title="AI 总结反馈" width="520px" destroy-on-close>
      <el-form label-position="top">
        <el-form-item label="总体评分"><el-rate v-model="feedbackForm.rating" /></el-form-item>
        <el-form-item label="结论">
          <el-radio-group v-model="feedbackForm.verdict">
            <el-radio value="helpful">有帮助</el-radio>
            <el-radio value="partial">部分准确</el-radio>
            <el-radio value="incorrect">存在错误</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="feedbackForm.comment" type="textarea" :rows="4" maxlength="2000" show-word-limit /></el-form-item>
        <el-form-item label="建议修正"><el-input v-model="feedbackForm.correctionText" type="textarea" :rows="4" maxlength="4000" show-word-limit /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="feedbackVisible = false">取消</el-button>
        <el-button type="primary" :loading="feedbackSaving" @click="submitFeedback">提交反馈</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { useRoute } from 'vue-router';
import {
  getPortalOverview,
  listPortalStudents,
  openLessonAsset,
  type LessonAssetView,
  type PortalLesson,
  type PortalOverview,
  type PortalStudent,
  type PortalStudentRelation,
  type PortalSummary,
} from '../api';
import { createSummaryFeedback } from '../../ai/api';

const loading = ref(false);
const route = useRoute();
const requestedTab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab;
const activeTab = ref(['lessons', 'exams', 'summaries'].includes(String(requestedTab)) ? String(requestedTab) : 'lessons');
const students = ref<PortalStudentRelation[]>([]);
const selectedStudentId = ref('');
const overview = ref<PortalOverview | null>(null);
const lessonVisible = ref(false);
const selectedLesson = ref<PortalLesson | null>(null);
const feedbackVisible = ref(false);
const feedbackSaving = ref(false);
const feedbackSummary = ref<PortalSummary | null>(null);
const feedbackForm = reactive({ rating: 5, verdict: 'helpful' as 'helpful' | 'partial' | 'incorrect', comment: '', correctionText: '' });

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

function openFeedback(summary: PortalSummary) {
  feedbackSummary.value = summary;
  Object.assign(feedbackForm, { rating: 5, verdict: 'helpful', comment: '', correctionText: '' });
  feedbackVisible.value = true;
}

async function submitFeedback() {
  if (!feedbackSummary.value) return;
  if (feedbackForm.verdict === 'incorrect' && !feedbackForm.comment.trim() && !feedbackForm.correctionText.trim()) {
    ElMessage.warning('标记存在错误时，请填写说明或修正建议');
    return;
  }
  feedbackSaving.value = true;
  try {
    await createSummaryFeedback(feedbackSummary.value.id, {
      rating: feedbackForm.rating,
      verdict: feedbackForm.verdict,
      comment: feedbackForm.comment.trim() || undefined,
      correctionText: feedbackForm.correctionText.trim() || undefined,
    });
    feedbackVisible.value = false;
    ElMessage.success('反馈已提交，感谢帮助改进 AI 总结');
  } finally {
    feedbackSaving.value = false;
  }
}

const studentName = (student: PortalStudent) => student.realName || student.username;
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const summaryType = (value: string) => ({
  student: '学生总结', exam: '考试总结', class: '班级总结', parent_report: '家长报告',
}[value] || value);
const summaryEntries = (content: unknown): Array<[string, string]> => {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return [['内容', String(content || '-')]];
  return Object.entries(content as Record<string, unknown>)
    .filter(([key]) => key !== 'schemaVersion')
    .map(([key, value]) => [summaryField(key), summaryValue(value)])
    .filter((entry): entry is [string, string] => Boolean(entry[1]));
};

const summaryField = (key: string) => ({
  headline: '核心结论', overview: '整体概览', strengths: '优势', risks: '需关注', actions: '行动建议', needsReview: '需人工确认',
}[key] || key);
const summaryValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.map(summaryValue).filter(Boolean).join('；');
  if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
    return String((value as { text: string }).text);
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
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
