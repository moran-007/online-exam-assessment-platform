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
        <el-select v-model="examFilter.status" clearable placeholder="状态" style="width: 130px" @change="loadFirstExamPage">
          <el-option v-for="status in statusOptions" :key="status.value" :label="status.label" :value="status.value" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstExamPage">查询</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreateExam">创建考试</el-button>
        <el-button :icon="DataAnalysis" :disabled="!selectedExam && !exams.length" @click="openRanking()">查看排名</el-button>
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>
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
            <template #default="{ row }">{{ statusLabel(row.status) }}</template>
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
              <div class="question-actions">
                <el-dropdown trigger="click" @command="(command) => handleExamCommand(row, command)" @click.stop>
                  <el-button size="small">操作</el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="edit">编辑</el-dropdown-item>
                      <el-dropdown-item command="trial">试答</el-dropdown-item>
                      <el-dropdown-item command="ranking">成绩</el-dropdown-item>
                      <el-dropdown-item command="announcementReads">公告阅读</el-dropdown-item>
                      <el-dropdown-item v-if="row.status === 'draft'" command="publish">发布</el-dropdown-item>
                      <el-dropdown-item v-else-if="row.status === 'scheduled'" command="unpublish">取消发布</el-dropdown-item>
                      <el-dropdown-item v-if="row.status === 'scheduled'" command="start">开始</el-dropdown-item>
                      <el-dropdown-item v-if="row.status === 'running'" command="end">结束</el-dropdown-item>
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
            small
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
          <el-select v-model="form.paperId" style="width: 100%">
            <el-option v-for="paper in papers" :key="paper.id" :label="paper.name" :value="paper.id" />
          </el-select>
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
            <el-date-picker v-model="form.endTime" type="datetime" style="width: 100%" />
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
          <el-select v-model="form.status" style="width: 100%">
            <el-option v-for="status in statusOptions" :key="status.value" :label="status.label" :value="status.value" />
          </el-select>
        </el-form-item>
        <el-alert
          v-if="editingId && !canSaveCore"
          title="进行中或已结束考试仅支持单独更新状态，核心配置请复制或新建考试后调整。"
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
          <el-tag>{{ statusLabel(selectedExam.status) }}</el-tag>
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
        <el-table-column prop="status" label="状态" width="120" />
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
        <el-table :data="announcementReadReport.items" height="460">
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
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Check, Close, DataAnalysis, Delete, Edit, Plus, Refresh, Search, User, View } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

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
const editingId = ref('');
const editingOriginalStatus = ref('');
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const examFilter = reactive({
  keyword: '',
  courseId: '',
  classId: '',
  status: '',
  sortBy: 'createdAt',
  sortOrder: 'desc',
});
const examPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const now = new Date();
const form = reactive(baseForm());
const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已安排', value: 'scheduled' },
  { label: '进行中', value: 'running' },
  { label: '已结束', value: 'ended' },
];
const canSaveCore = computed(() => !['running', 'ended'].includes(editingOriginalStatus.value));
const selectedExamIds = computed(() => selectedExamRows.value.map((row) => row.id));

function baseForm() {
  const current = new Date();
  return {
    name: '',
    courseId: '',
    classId: '',
    paperId: '',
    startTime: current,
    endTime: new Date(current.getTime() + 24 * 60 * 60 * 1000),
    durationMinutes: 30,
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
    api('/courses?pageSize=100'),
    api('/classes?pageSize=100'),
    api('/papers?pageSize=100&status=published'),
    api(
      `/exams${buildQuery({
        page: examPagination.page,
        pageSize: examPagination.pageSize,
        keyword: examFilter.keyword,
        courseId: examFilter.courseId,
        classId: examFilter.classId,
        status: examFilter.status,
        sortBy: examFilter.sortBy,
        sortOrder: examFilter.sortOrder,
      })}`,
    ),
    api('/users/students'),
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

  const focusExamId = String(route.query.focusExamId || '');
  if (focusExamId) {
    const focusExam = exams.value.find((exam) => exam.id === focusExamId);
    if (focusExam) {
      previewExam(focusExam);
      ElMessage.info('已定位到相关考试');
    } else if (examPagination.pageSize < 100 || examFilter.keyword || examFilter.courseId || examFilter.classId || examFilter.status) {
      Object.assign(examFilter, { keyword: '', courseId: '', classId: '', status: '', sortBy: 'createdAt', sortOrder: 'desc' });
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
    await api(editingId.value ? `/exams/${editingId.value}` : '/exams', {
      method: editingId.value ? 'PATCH' : 'POST',
      body: payload,
    });
    ElMessage.success(editingId.value ? '考试已保存' : '已创建');
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
    endTime: new Date(row.endTime),
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
  Object.assign(form, baseForm(), {
    courseId: courses.value[0]?.id || '',
    classId: '',
    paperId: papers.value[0]?.id || '',
    resultVisibility: defaultResultVisibility(),
  });
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

async function createExam() {
  const payload = {
    ...form,
    startTime: form.startTime.toISOString(),
    endTime: form.endTime.toISOString(),
    antiCheatConfig: { resultVisibility: { ...form.resultVisibility } },
  };
  delete payload.resultVisibility;
  await api('/exams', {
    method: 'POST',
    body: payload,
  });
  ElMessage.success('已创建');
  resetForm();
  await loadAll();
}

async function publish(row) {
  try {
    await api(`/exams/${row.id}/publish`, { method: 'POST' });
    ElMessage.success('已发布');
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
}

async function unpublish(row) {
  try {
    await api(`/exams/${row.id}/unpublish`, { method: 'POST' });
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
    await api(`/exams/${row.id}`, {
      method: 'PATCH',
      body: { status },
    });
    ElMessage.success(`状态已更新为${statusLabel(status)}`);
    await loadAll();
  } catch (error) {
    ElMessage.error(error.message);
  }
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
    const result = await api('/exams/batch/status', {
      method: 'PATCH',
      body: { ids: selectedExamIds.value, status: bulkStatus.value },
    });
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
    await api(`/exams/${row.id}`, { method: 'DELETE' });
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
  const data = await api(`/exams/${row.id}/results?pageSize=100`);
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
    announcementReadReport.value = await api(`/exams/${row.id}/announcement-reads`);
    announcementReadsVisible.value = true;
  } catch (error) {
    ElMessage.error(error.message || '公告阅读统计加载失败');
  } finally {
    announcementReadsLoading.value = false;
  }
}

function statusLabel(value) {
  return statusOptions.find((status) => status.value === value)?.label ?? value;
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

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
