<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">考试管理</h1>
      <div class="toolbar">
        <el-input
          v-model="examFilter.keyword"
          clearable
          placeholder="考试关键词"
          style="width: 180px"
          @keyup.enter="loadFirstExamPage"
          @clear="loadFirstExamPage"
        />
        <el-select v-model="examFilter.courseId" clearable placeholder="课程" style="width: 170px" @change="loadFirstExamPage">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-select v-model="examFilter.classId" clearable placeholder="班级" style="width: 150px" @change="loadFirstExamPage">
          <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstExamPage">查询</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreateExam">创建考试</el-button>
        <el-button :icon="DataAnalysis" :disabled="!selectedExam && !exams.length" @click="openRanking()">查看排名</el-button>
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>
    <div class="status-guide">
      <div v-for="status in statusOptions" :key="status.value" class="status-guide-item">
        <el-tag :type="status.type" effect="plain">{{ status.label }}</el-tag>
        <span>{{ status.description }}</span>
      </div>
      <div class="status-guide-note">
        考试与试卷关系：创建考试只能选择“已公开”试卷；进行中/已结束考试默认锁定核心配置，管理员可兜底调整。
      </div>
    </div>
    <el-tabs v-model="examStatusTab" class="page-tabs" @tab-change="loadFirstExamPage">
      <el-tab-pane label="正在进行中" name="running" />
      <el-tab-pane label="即将开始" name="scheduled" />
      <el-tab-pane label="历史考试" name="ended" />
      <el-tab-pane label="已归档" name="archived" />
      <el-tab-pane label="草稿" name="draft" />
    </el-tabs>
    <div class="exam-admin-grid">
      <div class="panel library-table-panel exam-table-panel">
        <div class="toolbar exam-sim-toolbar">
          <el-select v-model="selectedStudentId" filterable placeholder="选择模拟学生" style="width: 220px">
            <el-option
              v-for="student in students"
              :key="student.id"
              :label="student.realName ? `${student.realName}（${student.username}）` : student.username"
              :value="student.id"
            />
          </el-select>
          <span class="muted">试答不计成绩；模拟学生会走完整学生流程。</span>
          <el-select v-model="bulkStatus" placeholder="批量状态" style="width: 130px">
            <el-option v-for="status in statusOptions" :key="status.value" :label="status.label" :value="status.value" />
          </el-select>
          <el-button :icon="Check" :disabled="!selectedExamIds.length || !bulkStatus" @click="bulkUpdateStatus">
            批量更新
          </el-button>
        </div>
        <el-table
          :data="exams"
          height="100%"
          highlight-current-row
          class="question-list-table"
          :default-sort="{ prop: examFilter.sortBy, order: examFilter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
          @row-click="previewExam"
          @selection-change="handleSelectionChange"
          @sort-change="handleExamSortChange"
        >
          <el-table-column type="selection" width="48" />
          <el-table-column prop="name" label="考试" min-width="180" sortable="custom" />
          <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="120" />
          <el-table-column v-if="showLowColumns" prop="className" label="班级" width="130" />
          <el-table-column v-if="showMediumColumns" prop="paperName" label="试卷" min-width="150" />
          <el-table-column prop="status" label="状态" width="100" sortable="custom">
            <template #default="{ row }">
              <div class="row-action-cell" @click.stop @mousedown.stop>
                <el-dropdown trigger="click" @command="(status) => changeStatus(row, status)">
                  <el-tag class="status-action-tag" :type="statusType(row.status)" effect="plain">
                    {{ statusLabel(row.status) }}
                  </el-tag>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item
                        v-for="status in examStatusTargets(row)"
                        :key="status.value"
                        :command="status.value"
                      >
                        {{ examStatusActionText(row.status, status.value) }}
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="showLowColumns" prop="startTime" label="开始时间" width="170" sortable="custom">
            <template #default="{ row }">{{ formatDateTime(row.startTime) }}</template>
          </el-table-column>
          <el-table-column v-if="showLowColumns" prop="endTime" label="结束时间" width="170" sortable="custom">
            <template #default="{ row }">{{ formatDateTime(row.endTime) }}</template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="durationMinutes" label="时长" width="86" sortable="custom" />
          <el-table-column v-if="showLowColumns" prop="createdAt" label="录入时间" width="170" sortable="custom">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" label="公告" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.announcement" type="warning" size="small">已设置</el-tag>
              <span v-else class="muted">无</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <div class="question-actions row-action-cell" @click.stop @mousedown.stop>
                <el-dropdown trigger="click" @command="(command) => handleExamCommand(row, command)">
                  <el-button size="small" @click.stop>操作</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">编辑</el-dropdown-item>
                      <el-dropdown-item command="trial">试答</el-dropdown-item>
                      <el-dropdown-item command="ranking">成绩</el-dropdown-item>
                      <el-dropdown-item command="announcementReads">公告阅读</el-dropdown-item>
                      <el-dropdown-item
                        v-for="status in examStatusTargets(row)"
                        :key="status.value"
                        :command="`status:${status.value}`"
                      >
                        {{ examStatusActionText(row.status, status.value) }}
                      </el-dropdown-item>
                      <el-dropdown-item command="simulate">模拟学生</el-dropdown-item>
                      <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-footer">
          <span class="muted">共 {{ examPagination.total }} 场考试</span>
          <el-pagination
            v-model:current-page="examPagination.page"
            v-model:page-size="examPagination.pageSize"
            background
            size="small"
            :pager-count="5"
            layout="sizes, prev, pager, next"
            :page-sizes="pageSizes"
            :total="examPagination.total"
            @size-change="handleExamSizeChange"
            @current-change="handleExamCurrentChange"
          />
        </div>
      </div>
    </div>

    <el-dialog v-model="examFormVisible" :title="editingId ? '编辑考试' : '创建考试'" width="720px" destroy-on-close>
      <el-form :model="form" label-width="86px">
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
        <el-form-item label="课程">
          <el-select v-model="form.courseId" style="width: 100%">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="试卷">
          <el-select v-model="form.paperId" style="width: 100%" @change="handlePaperChange">
            <el-option v-for="paper in papers" :key="paper.id" :label="paper.name" :value="paper.id" />
          </el-select>
          <div v-if="paperDurationHint" class="form-tip">{{ paperDurationHint }}</div>
        </el-form-item>
        <el-form-item label="班级">
          <el-select v-model="form.classId" clearable style="width: 100%" placeholder="不选择则所有学生可见">
            <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <div class="exam-form-grid">
          <el-form-item label="开始">
            <el-date-picker v-model="form.startTime" type="datetime" style="width: 100%" />
          </el-form-item>
          <el-form-item label="结束">
            <el-date-picker v-model="form.endTime" type="datetime" style="width: 100%" disabled />
          </el-form-item>
          <el-form-item label="时长">
            <el-input-number v-model="form.durationMinutes" :min="1" />
          </el-form-item>
          <el-form-item label="次数">
            <el-input-number v-model="form.attemptLimit" :min="1" />
          </el-form-item>
        </div>
        <el-form-item label="公告">
          <el-input
            v-model="form.announcement"
            type="textarea"
            :rows="4"
            resize="vertical"
            placeholder="学生进入考试前需要阅读的公告"
          />
        </el-form-item>
        <el-form-item label="结果开放">
          <div class="result-visibility-box">
            <el-checkbox v-model="form.resultVisibility.questionScore">小题得分</el-checkbox>
            <el-checkbox v-model="form.resultVisibility.content">题干内容</el-checkbox>
            <el-checkbox v-model="form.resultVisibility.studentAnswer">学生作答</el-checkbox>
            <el-checkbox v-model="form.resultVisibility.correctness">对错结果</el-checkbox>
            <el-checkbox v-model="form.resultVisibility.correctAnswer">正确答案</el-checkbox>
            <el-checkbox v-model="form.resultVisibility.analysis">解析</el-checkbox>
            <div class="muted result-visibility-tip">
              这些选项仅控制考试未结束或次数未用完时的提前开放内容；默认只开放分数。
            </div>
          </div>
        </el-form-item>
        <el-form-item v-if="editingId" label="状态">
          <div class="status-control-row">
            <el-select v-model="form.status" style="width: 180px">
            <el-option v-for="status in statusOptions" :key="status.value" :label="status.label" :value="status.value" />
            </el-select>
            <span class="muted">{{ formStatusDescription }}</span>
          </div>
        </el-form-item>
        <el-alert
          v-if="editingId && !canSaveCore"
          title="进行中或已结束考试仅支持单独更新状态；管理员账号可直接调整核心配置。"
          type="warning"
          show-icon
          :closable="false"
          class="batch-alert"
        />
      </el-form>
      <template #footer>
        <el-button @click="closeExamForm">取消</el-button>
        <el-button v-if="editingId" :icon="Check" @click="saveStatusOnly">仅更新状态</el-button>
        <el-button type="primary" :icon="editingId ? Edit : Plus" :disabled="!!editingId && !canSaveCore" @click="saveExam">
          {{ editingId ? '保存考试' : '创建考试' }}
        </el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="examPreviewVisible" :title="selectedExam ? `考试预览：${selectedExam.name}` : '考试预览'" size="640px" destroy-on-close>
      <div v-if="selectedExam" class="exam-preview-drawer">
        <div class="paper-preview-head">
          <div>
            <h2>{{ selectedExam.name }}</h2>
            <span class="muted">{{ selectedExam.courseName }} · {{ selectedExam.paperName }}</span>
            <span class="muted">范围：{{ selectedExam.className || '公开' }}</span>
          </div>
          <div class="status-inline">
            <el-tag :type="statusType(selectedExam.status)" effect="plain">{{ statusLabel(selectedExam.status) }}</el-tag>
            <span class="muted">{{ selectedExamStatusDescription }}</span>
          </div>
        </div>
        <div class="exam-preview-meta">
          <span>开始：{{ formatDateTime(selectedExam.startTime) }}</span>
          <span>结束：{{ formatDateTime(selectedExam.endTime) }}</span>
          <span>时长：{{ selectedExam.durationMinutes }} 分钟</span>
          <span>次数：{{ selectedExam.attemptLimit }} 次</span>
        </div>
        <el-alert
          v-if="selectedExam.announcement"
          type="warning"
          :closable="false"
          show-icon
          :title="selectedExam.announcement"
        />
        <div class="toolbar">
          <el-button :icon="Edit" @click="editExam(selectedExam)">编辑考试</el-button>
          <el-button :icon="View" @click="trial(selectedExam)">预览/试答试卷</el-button>
          <el-button :icon="User" @click="simulate(selectedExam)">模拟学生</el-button>
          <el-button :icon="DataAnalysis" @click="openRanking(selectedExam)">查看排名</el-button>
          <el-button :icon="DataAnalysis" :loading="announcementReadsLoading" @click="openAnnouncementReads(selectedExam)">
            公告阅读
          </el-button>
        </div>
      </div>
      <el-empty v-else description="请先选择考试" />
    </el-drawer>

    <el-drawer v-model="rankingVisible" :title="selectedExam ? `排名：${selectedExam.name}` : '排名'" size="720px" destroy-on-close>
      <el-table :data="results" height="520">
        <el-table-column prop="rank" label="排名" width="80" />
        <el-table-column prop="studentName" label="学生" min-width="140" />
        <el-table-column prop="username" label="账号" width="120" />
        <el-table-column prop="attemptNo" label="第几次" width="80" />
        <el-table-column prop="totalScore" label="总分" width="90" />
        <el-table-column prop="objectiveScore" label="客观题" width="90" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="attemptStatusType(row.status)" effect="plain">
              {{ attemptStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="submittedAt" label="提交时间" min-width="170" />
      </el-table>
    </el-drawer>

    <el-drawer
      v-model="announcementReadsVisible"
      :title="announcementReadReport ? `公告阅读：${announcementReadReport.examName}` : '公告阅读'"
      size="760px"
      destroy-on-close
    >
      <div v-if="announcementReadReport" class="announcement-read-drawer">
        <el-alert
          v-if="announcementReadReport.announcement"
          type="warning"
          show-icon
          :closable="false"
          :title="`第 ${announcementReadReport.announcement.version} 版公告`"
          :description="announcementReadReport.announcement.content"
        />
        <el-empty v-else description="该考试暂未设置公告" />
        <div class="announcement-stat-grid">
          <div>
            <b>{{ announcementReadReport.expectedCount }}</b>
            <span>应读人数</span>
          </div>
          <div>
            <b>{{ announcementReadReport.readCount }}</b>
            <span>已读</span>
          </div>
          <div>
            <b>{{ announcementReadReport.unreadCount }}</b>
            <span>未读</span>
          </div>
          <div>
            <b>{{ announcementReadReport.enteredCount }}</b>
            <span>已进入</span>
          </div>
          <div>
            <b>{{ announcementReadReport.submittedCount || 0 }}</b>
            <span>已提交</span>
          </div>
        </div>
        <div class="toolbar announcement-read-toolbar">
          <el-checkbox v-model="announcementUnreadOnly">只看未读</el-checkbox>
          <el-button
            type="warning"
            plain
            :loading="announcementRemindLoading"
            :disabled="!announcementUnreadItems.length || !announcementReadReport.announcement"
            @click="sendAnnouncementReminder"
          >
            发送未读提醒
          </el-button>
          <el-button :disabled="!announcementUnreadItems.length" @click="exportAnnouncementUnreadCsv">
            导出未读名单
          </el-button>
        </div>
        <el-table :data="announcementReadItems" height="430">
          <el-table-column label="学生" min-width="160">
            <template #default="{ row }">{{ row.realName || row.username }}</template>
          </el-table-column>
          <el-table-column prop="username" label="账号" width="130" />
          <el-table-column label="阅读" width="90">
            <template #default="{ row }">
              <el-tag :type="row.read ? 'success' : 'warning'" size="small">{{ row.read ? '已读' : '未读' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="阅读时间" min-width="170">
            <template #default="{ row }">{{ formatDateTime(row.readAt) }}</template>
          </el-table-column>
          <el-table-column label="进入考试" width="100">
            <template #default="{ row }">
              <el-tag :type="row.entered ? 'success' : 'info'" size="small">{{ row.entered ? '已进入' : '未进入' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交" width="90">
            <template #default="{ row }">
              <el-tag :type="row.submitted ? 'success' : 'info'" size="small">{{ row.submitted ? '已交' : '未交' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <el-empty v-else description="请选择考试并加载阅读统计" />
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, DataAnalysis, Edit, Plus, Refresh, Search, User, View } from '@element-plus/icons-vue';
import { getCurrentUser } from '../../../api';
import { useResponsiveColumns } from '../../../composables/useResponsiveColumns';
import {
  bulkUpdateManagedExams,
  createManagedExam,
  endManagedExam,
  getAnnouncementReads,
  getManagedExamResults,
  listExamClasses,
  listExamCourses,
  listExamPapers,
  listExamStudents,
  listManagedExams,
  publishManagedExam,
  remindAnnouncementUnread,
  removeManagedExam,
  unpublishManagedExam,
  updateManagedExam,
} from '../api';
import {
  examStatusOptions,
  statusDescription,
  statusLabel as getStatusLabel,
  statusTagType,
  statusTransitionOptions,
} from '../../../statusMeta';

const router = useRouter();
const route = useRoute();
const courses = ref([]);
const classes = ref([]);
const papers = ref([]);
const exams = ref([]);
const results = ref([]);
const students = ref([]);
const selectedStudentId = ref('');
const selectedExam = ref(null);
const selectedExamRows = ref([]);
const bulkStatus = ref('');
const examFormVisible = ref(false);
const examPreviewVisible = ref(false);
const rankingVisible = ref(false);
const announcementReadsVisible = ref(false);
const announcementReadReport = ref(null);
const announcementReadsLoading = ref(false);
const announcementRemindLoading = ref(false);
const announcementUnreadOnly = ref(false);
const editingId = ref('');
const editingOriginalStatus = ref('');
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const examFilter = reactive({
  keyword: '',
  courseId: '',
  classId: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
const examStatusTab = ref('running');
const examPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const form = reactive(baseForm());
const currentUser = ref(getCurrentUser());
const statusOptions = examStatusOptions;
const canOverrideLockedExam = computed(() => ['SUPER_ADMIN', 'ADMIN'].includes(currentUser.value?.userType));
const canSaveCore = computed(() => canOverrideLockedExam.value || !['running', 'ended'].includes(editingOriginalStatus.value));
const selectedExamIds = computed(() => selectedExamRows.value.map((row) => row.id));
const selectedPaper = computed(() => papers.value.find((paper) => paper.id === form.paperId) ?? null);
const paperDurationHint = computed(() =>
  selectedPaper.value ? `试卷答题时长 ${selectedPaper.value.durationMinutes || 0} 分钟，可在此处调整本场考试时长` : '',
);
const announcementUnreadItems = computed(() => (announcementReadReport.value?.items ?? []).filter((item) => !item.read));
const announcementReadItems = computed(() =>
  announcementUnreadOnly.value ? announcementUnreadItems.value : announcementReadReport.value?.items ?? [],
);
const formStatusDescription = computed(() => statusDescription('exam', form.status));
const selectedExamStatusDescription = computed(() =>
  selectedExam.value ? statusDescription('exam', selectedExam.value.status) : '',
);

function baseForm() {
  const current = new Date();
  const durationMinutes = 30;
  return {
    name: '',
    courseId: '',
    classId: '',
    paperId: '',
    startTime: current,
    endTime: examEndFrom(current, durationMinutes),
    durationMinutes,
    attemptLimit: 1,
    announcement: '',
    resultVisibility: defaultResultVisibility(),
    status: 'draft',
  };
}

function defaultResultVisibility() {
  return {
    questionScore: true,
    content: false,
    studentAnswer: false,
    correctness: false,
    correctAnswer: false,
    analysis: false,
  };
}

async function loadAll() {
  const [coursePage, classPage, paperPage, examPage, studentList] = await Promise.all([
    listExamCourses(),
    listExamClasses(),
    listExamPapers(),
    listManagedExams({
        page: examPagination.page,
        pageSize: examPagination.pageSize,
        keyword: examFilter.keyword || undefined,
        courseId: examFilter.courseId || undefined,
        classId: examFilter.classId || undefined,
        status: examStatusTab.value,
        sortBy: examFilter.sortBy,
        sortOrder: examFilter.sortOrder,
      }),
    listExamStudents(),
  ]);
  courses.value = coursePage.items;
  classes.value = classPage.items;
  papers.value = paperPage.items;
  exams.value = examPage.items;
  examPagination.page = examPage.page;
  examPagination.pageSize = examPage.pageSize;
  examPagination.total = examPage.total;
  students.value = studentList;
  selectedStudentId.value = selectedStudentId.value || students.value[0]?.id || '';
  form.courseId = form.courseId || courses.value[0]?.id || '';
  form.paperId = form.paperId || papers.value[0]?.id || '';
  if (!editingId.value && selectedPaper.value && form.durationMinutes === 30) {
    form.durationMinutes = selectedPaper.value.durationMinutes || form.durationMinutes;
    alignExamEndTime();
  }

  const focusExamId = String(route.query.focusExamId || '');
  if (focusExamId) {
    const focusExam = exams.value.find((exam) => exam.id === focusExamId);
    if (focusExam) {
      previewExam(focusExam);
      ElMessage.info('已定位到相关考试');
    } else if (examPagination.pageSize < 100 || examFilter.keyword || examFilter.courseId || examFilter.classId || examStatusTab.value !== 'running') {
      Object.assign(examFilter, { keyword: '', courseId: '', classId: '', sortBy: 'createdAt', sortOrder: 'desc' });
      examStatusTab.value = 'running';
      Object.assign(examPagination, { page: 1, pageSize: 100 });
      await loadAll();
    }
  }
}

function loadFirstExamPage() {
  examPagination.page = 1;
  return loadAll();
}

function handleExamSortChange({ prop, order }) {
  examFilter.sortBy = prop || 'createdAt';
  examFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return loadFirstExamPage();
}

function handleExamSizeChange(size) {
  examPagination.pageSize = size;
  examPagination.page = 1;
  loadAll();
}

function handleExamCurrentChange(page) {
  examPagination.page = page;
  loadAll();
}

async function saveExam() {
  alignExamEndTime();
  const targetTab = editingId.value ? examTabForStatus(form.status, form.startTime, form.endTime) : 'draft';
  const payload = {
    ...form,
    startTime: form.startTime.toISOString(),
    endTime: form.endTime.toISOString(),
    antiCheatConfig: { resultVisibility: { ...form.resultVisibility } },
  };
  delete payload.resultVisibility;
  if (!payload.classId) {
    if (editingId.value) payload.classId = null;
    else delete payload.classId;
  }
  if (!editingId.value) delete payload.status;

  try {
    await (editingId.value
      ? updateManagedExam(editingId.value, payload)
      : createManagedExam(payload));
    ElMessage.success(editingId.value ? '考试已保存' : '已创建');
    examStatusTab.value = targetTab;
    examFormVisible.value = false;
    resetForm();
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

function editExam(row) {
  selectedExam.value = row;
  editingId.value = row.id;
  editingOriginalStatus.value = row.status || '';
  Object.assign(form, {
    name: row.name,
    courseId: row.courseId,
    classId: row.classId || '',
    paperId: row.paperId,
    startTime: new Date(row.startTime),
    endTime: examEndFrom(row.startTime, row.durationMinutes),
    durationMinutes: row.durationMinutes,
    attemptLimit: row.attemptLimit,
    announcement: row.announcement || '',
    resultVisibility: { ...defaultResultVisibility(), ...(row.resultVisibility || {}) },
    status: ['running', 'ended'].includes(row.status) ? row.status : row.status || 'draft',
  });
  examFormVisible.value = true;
}

function resetForm() {
  editingId.value = '';
  editingOriginalStatus.value = '';
  const firstPaper = papers.value[0] ?? null;
  const nextForm = {
    ...baseForm(),
    courseId: courses.value[0]?.id || '',
    classId: '',
    paperId: firstPaper?.id || '',
    durationMinutes: firstPaper?.durationMinutes || baseForm().durationMinutes,
    resultVisibility: defaultResultVisibility(),
  };
  nextForm.endTime = examEndFrom(nextForm.startTime, nextForm.durationMinutes);
  Object.assign(form, nextForm);
}

function handlePaperChange() {
  if (editingId.value) return;
  if (selectedPaper.value?.durationMinutes) {
    form.durationMinutes = selectedPaper.value.durationMinutes;
    alignExamEndTime();
  }
}

function examEndFrom(startTime, durationMinutes) {
  const start = startTime instanceof Date ? startTime : new Date(startTime || Date.now());
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  const duration = Math.max(1, Math.round(Number(durationMinutes) || 1));
  return new Date(safeStart.getTime() + duration * 60 * 1000);
}

function alignExamEndTime() {
  form.endTime = examEndFrom(form.startTime, form.durationMinutes);
}

function examTabForStatus(status, startTime, endTime) {
  if (status === 'draft' || status === 'archived') return status;
  const nowTime = Date.now();
  const start = new Date(startTime || nowTime).getTime();
  const end = new Date(endTime || nowTime).getTime();
  if (status === 'ended' || end <= nowTime) return 'ended';
  if (status === 'scheduled' && start > nowTime) return 'scheduled';
  if (status === 'running' || status === 'scheduled') return 'running';
  return 'running';
}

function closeExamForm() {
  examFormVisible.value = false;
  resetForm();
}

function openCreateExam() {
  resetForm();
  examFormVisible.value = true;
}

function previewExam(row) {
  if (!row?.id) return;
  selectedExam.value = row;
  examPreviewVisible.value = true;
}

async function publish(row) {
  try {
    const result = await publishManagedExam(row.id);
    ElMessage.success(`考试状态已更新为${statusLabel(result.status || 'scheduled')}`);
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function unpublish(row) {
  try {
    await unpublishManagedExam(row.id);
    ElMessage.success('已取消发布');
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function saveStatusOnly() {
  if (!editingId.value) return;
  await changeStatus({ id: editingId.value }, form.status);
  examFormVisible.value = false;
  resetForm();
}

function handleSelectionChange(rows) {
  selectedExamRows.value = rows;
}

async function changeStatus(row, status) {
  try {
    if (status === 'archived') {
      await ElMessageBox.confirm(
        '归档后考试会从日常安排中收起，成绩和记录仍保留。需要重新维护时可恢复为草稿。',
        '归档考试',
        { type: 'warning', confirmButtonText: '归档', cancelButtonText: '取消' },
      );
    }
    if (status === 'ended') {
      await endExam(row);
      return;
    }
    await updateManagedExam(row.id, { status });
    ElMessage.success(`状态已更新为${statusLabel(status)}`);
    await loadAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function endExam(row) {
  await ElMessageBox.confirm(
    `确认立即结束考试“${row.name || ''}”？系统会提交所有进行中的答卷，并将考试结束时间更新为当前时间。`,
    '结束考试',
    { type: 'warning', confirmButtonText: '立即结束', cancelButtonText: '取消' },
  );
  const result = await endManagedExam(row.id);
  ElMessage.success(`考试已结束，已处理 ${result.finalizedAttemptCount || 0} 份进行中答卷`);
  await loadAll();
}

function handleExamCommand(row, command) {
  const handlers = {
    edit: () => editExam(row),
    trial: () => trial(row),
    ranking: () => openRanking(row),
    announcementReads: () => openAnnouncementReads(row),
    publish: () => publish(row),
    unpublish: () => unpublish(row),
    start: () => changeStatus(row, 'running'),
    end: () => changeStatus(row, 'ended'),
    simulate: () => simulate(row),
    delete: () => removeExam(row),
  };
  if (command?.startsWith('status:')) return changeStatus(row, command.slice('status:'.length));
  handlers[command]?.();
}

async function bulkUpdateStatus() {
  if (!selectedExamIds.value.length || !bulkStatus.value) {
    ElMessage.warning('请选择考试和目标状态');
    return;
  }

  try {
    await ElMessageBox.confirm(
      `确认将 ${selectedExamIds.value.length} 个考试批量设置为“${statusLabel(bulkStatus.value)}”？`,
      '批量更新考试状态',
      {
        type: 'warning',
        confirmButtonText: '批量更新',
        cancelButtonText: '取消',
      },
    );
    const result = await bulkUpdateManagedExams({ ids: selectedExamIds.value, status: bulkStatus.value });
    const failedText = result.failed?.length ? `，${result.failed.length} 个失败` : '';
    ElMessage.success(`已更新 ${result.successCount} 个考试${failedText}`);
    selectedExamRows.value = [];
    await loadAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message);
    }
  }
}

async function removeExam(row) {
  try {
    await ElMessageBox.confirm(`确认删除考试“${row.name}”？已有提交记录的考试不能删除。`, '删除考试', { type: 'warning' });
    await removeManagedExam(row.id);
    ElMessage.success('已删除');
    await loadAll();
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message ?? '已取消');
    }
  }
}

function simulate(row) {
  if (!selectedStudentId.value) {
    ElMessage.error('请先选择模拟学生');
    return;
  }
  router.push(`/student/exams/${row.id}?simulateStudentId=${selectedStudentId.value}`);
}

function trial(row) {
  router.push(`/papers/${row.paperId}/answer?mode=trial&examId=${row.id}`);
}

async function loadResults(row) {
  selectedExam.value = row;
  const data = await getManagedExamResults(row.id, { pageSize: 100 });
  results.value = data.items;
}

async function openRanking(row = selectedExam.value || exams.value[0]) {
  if (!row?.id) {
    ElMessage.warning('请先选择考试');
    return;
  }
  await loadResults(row);
  rankingVisible.value = true;
}

async function openAnnouncementReads(row = selectedExam.value || exams.value[0]) {
  if (!row?.id) {
    ElMessage.warning('请先选择考试');
    return;
  }
  selectedExam.value = row;
  announcementReadsLoading.value = true;
  try {
    announcementReadReport.value = await getAnnouncementReads(row.id);
    announcementUnreadOnly.value = false;
    announcementReadsVisible.value = true;
  } catch (error) {
    ElMessage.error(error.message || '公告阅读统计加载失败');
  } finally {
    announcementReadsLoading.value = false;
  }
}

async function sendAnnouncementReminder() {
  if (!announcementReadReport.value?.examId) return;
  try {
    await ElMessageBox.confirm(
      `将给 ${announcementUnreadItems.value.length} 名未读学生生成站内提醒，是否继续？`,
      '发送公告阅读提醒',
      { type: 'warning', confirmButtonText: '发送提醒', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  announcementRemindLoading.value = true;
  try {
    const result = await remindAnnouncementUnread(announcementReadReport.value.examId);
    ElMessage.success(`已生成 ${result.createdCount} 条提醒，跳过 ${result.skippedCount} 条已有提醒`);
  } catch (error) {
    ElMessage.error(error.message || '发送提醒失败');
  } finally {
    announcementRemindLoading.value = false;
  }
}

function exportAnnouncementUnreadCsv() {
  const rows = announcementUnreadItems.value;
  if (!rows.length) {
    ElMessage.warning('当前没有未读学生');
    return;
  }
  const header = ['学生', '账号', '是否进入考试', '是否提交', '考试'];
  const lines = [
    header,
    ...rows.map((row) => [
      row.realName || row.username,
      row.username,
      row.entered ? '已进入' : '未进入',
      row.submitted ? '已提交' : '未提交',
      announcementReadReport.value?.examName || '',
    ]),
  ].map((line) => line.map(csvCell).join(','));
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${announcementReadReport.value?.examName || '考试公告'}-未读名单.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function statusLabel(value) {
  return getStatusLabel('exam', value);
}

function statusType(value) {
  return statusTagType('exam', value);
}

function attemptStatusLabel(value) {
  return getStatusLabel('attempt', value);
}

function attemptStatusType(value) {
  return statusTagType('attempt', value);
}

function examStatusTargets(row) {
  return statusTransitionOptions('exam', row?.status);
}

function examStatusActionText(currentStatus, targetStatus) {
  const key = `${currentStatus}->${targetStatus}`;
  const map = {
    'draft->scheduled': '安排考试',
    'draft->running': '直接开始',
    'draft->archived': '归档考试',
    'scheduled->draft': '转回草稿',
    'scheduled->running': '开始考试',
    'scheduled->ended': '结束考试',
    'scheduled->archived': '归档考试',
    'running->ended': '结束考试',
    'ended->running': '重新启动考试',
    'ended->archived': '归档考试',
    'archived->draft': '恢复草稿',
  };
  return map[key] ?? `设为${statusLabel(targetStatus)}`;
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

watch(
  () => [form.startTime, form.durationMinutes],
  () => {
    if (examFormVisible.value) alignExamEndTime();
  },
);

onMounted(loadAll);
</script>

<style scoped>
.announcement-read-drawer {
  display: grid;
  gap: 16px;
}

.announcement-stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 10px;
}

.announcement-stat-grid > div {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-light);
}

.announcement-stat-grid b {
  display: block;
  color: var(--el-text-color-primary);
  font-size: 22px;
  line-height: 1.2;
}

.announcement-stat-grid span {
  display: block;
  margin-top: 6px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
