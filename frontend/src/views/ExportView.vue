<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">导出中心</h1>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <div class="export-workspace">
      <div class="panel export-target-panel">
        <el-tabs v-model="activeTab">
          <el-tab-pane label="试卷导出" name="papers">
            <div class="toolbar export-filter-row">
              <el-input
                v-model="paperFilter.keyword"
                clearable
                placeholder="搜索试卷"
                style="width: 220px"
                @keyup.enter="loadPapers"
                @clear="loadPapers"
              />
              <el-select v-model="paperFilter.courseId" clearable filterable placeholder="课程" style="width: 180px" @change="loadPapers">
                <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
              </el-select>
              <el-select v-model="paperFilter.status" clearable placeholder="状态" style="width: 140px" @change="loadPapers">
                <el-option label="草稿" value="draft" />
                <el-option label="已发布" value="published" />
                <el-option label="已归档" value="archived" />
              </el-select>
              <el-button :icon="Search" @click="loadPapers">查询</el-button>
            </div>

            <el-table
              :data="papers"
              max-height="340"
              class="question-list-table"
              :default-sort="{ prop: paperFilter.sortBy, order: paperFilter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
              @sort-change="handlePaperSortChange"
            >
              <el-table-column prop="name" label="试卷" min-width="220" sortable="custom" show-overflow-tooltip />
              <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="150" />
              <el-table-column prop="questionCount" label="题数" width="80" />
              <el-table-column v-if="showMediumColumns" prop="totalScore" label="总分" width="90" sortable="custom" />
              <el-table-column v-if="showMediumColumns" prop="durationMinutes" label="时长" width="90" sortable="custom" />
              <el-table-column prop="status" label="状态" width="100" sortable="custom">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'published' ? 'success' : 'info'">{{ paperStatusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="showLowColumns" prop="createdAt" label="录入时间" width="170" sortable="custom">
                <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="导出" width="120">
                <template #default="{ row }">
                  <el-dropdown trigger="click" @command="(command) => exportPaper(row, command)">
                    <el-button size="small" type="primary" plain :icon="Download">导出</el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="student-pdf">PDF 学生版</el-dropdown-item>
                        <el-dropdown-item command="answer-pdf">PDF 答案解析</el-dropdown-item>
                        <el-dropdown-item command="answer-docx">Word 答案解析</el-dropdown-item>
                        <el-dropdown-item command="transfer-csv">CSV 迁移表</el-dropdown-item>
                        <el-dropdown-item command="transfer-json">JSON 迁移表</el-dropdown-item>
                        <el-dropdown-item command="transfer-zip">ZIP 迁移包</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
            </el-table>
            <el-alert
              class="export-field-alert"
              type="info"
              show-icon
              :closable="false"
              title="CSV/JSON 用于回导迁移，必需字段：schemaVersion、title、type、difficulty、defaultScore、contentMarkdown、optionsJson、answerJson、scoringRuleJson、analysisMarkdown、tagNames、knowledgePointNames。PDF/Word 仅用于阅读或讲评。"
            />
          </el-tab-pane>

          <el-tab-pane label="成绩 / 考试导出" name="exams">
            <div class="toolbar export-filter-row">
              <el-input
                v-model="examFilter.keyword"
                clearable
                placeholder="搜索考试"
                style="width: 220px"
                @keyup.enter="loadExams"
                @clear="loadExams"
              />
              <el-select v-model="examFilter.courseId" clearable filterable placeholder="课程" style="width: 180px" @change="loadExams">
                <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
              </el-select>
              <el-select v-model="examFilter.classId" clearable filterable placeholder="班级" style="width: 180px" @change="loadExams">
                <el-option v-for="item in classes" :key="item.id" :label="item.name" :value="item.id" />
              </el-select>
              <el-select v-model="examFilter.status" clearable placeholder="状态" style="width: 140px" @change="loadExams">
                <el-option label="草稿" value="draft" />
                <el-option label="已安排" value="scheduled" />
                <el-option label="进行中" value="running" />
                <el-option label="已结束" value="ended" />
              </el-select>
              <el-button :icon="Search" @click="loadExams">查询</el-button>
            </div>

            <el-table
              :data="exams"
              max-height="340"
              class="question-list-table"
              :default-sort="{ prop: examFilter.sortBy, order: examFilter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
              @sort-change="handleExamSortChange"
            >
              <el-table-column prop="name" label="考试" min-width="210" sortable="custom" show-overflow-tooltip />
              <el-table-column v-if="showMediumColumns" prop="paperName" label="试卷" min-width="180" show-overflow-tooltip />
              <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="140" />
              <el-table-column v-if="showLowColumns" prop="className" label="班级" width="120" />
              <el-table-column v-if="showMediumColumns" prop="attemptCount" label="提交/进入" width="110" sortable="custom" />
              <el-table-column prop="status" label="状态" width="100" sortable="custom">
                <template #default="{ row }">
                  <el-tag :type="row.status === 'ended' ? 'info' : row.status === 'running' ? 'success' : 'warning'">
                    {{ examStatusLabel(row.status) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column v-if="showLowColumns" prop="startTime" label="开始时间" width="170" sortable="custom">
                <template #default="{ row }">{{ formatDate(row.startTime) }}</template>
              </el-table-column>
              <el-table-column label="导出" width="120">
                <template #default="{ row }">
                  <el-dropdown trigger="click" @command="(command) => exportExam(row, command)">
                    <el-button size="small" type="primary" plain :icon="Download">导出</el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="results-csv">成绩 CSV</el-dropdown-item>
                        <el-dropdown-item command="grading-csv">批改记录 CSV</el-dropdown-item>
                        <el-dropdown-item command="paper-pdf">试卷 PDF</el-dropdown-item>
                        <el-dropdown-item command="paper-answer-pdf">试卷答案 PDF</el-dropdown-item>
                        <el-dropdown-item command="paper-transfer-csv">试卷 CSV 迁移表</el-dropdown-item>
                        <el-dropdown-item command="paper-transfer-json">试卷 JSON 迁移表</el-dropdown-item>
                        <el-dropdown-item command="paper-transfer-zip">试卷 ZIP 迁移包</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </el-table-column>
            </el-table>
            <el-alert
              class="export-field-alert"
              type="info"
              show-icon
              :closable="false"
              title="考试列表中的“试卷 CSV/JSON/ZIP 迁移”会导出关联试卷的完整回导数据；普通试卷 PDF 仅用于阅读。"
            />
          </el-tab-pane>
        </el-tabs>
      </div>

      <div class="panel library-table-panel export-record-panel">
        <div class="section-head">
          <div>
            <h3>导出记录</h3>
            <span class="muted">直接导出会自动留下记录，可在这里重复下载。</span>
          </div>
          <el-select v-model="taskFilter.type" clearable placeholder="记录类型" style="width: 160px" @change="loadTasks">
            <el-option v-for="item in exportTypes" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </div>
        <el-table :data="tasks" height="100%" class="question-list-table">
          <el-table-column prop="type" label="类型" min-width="130">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : 'warning'">
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="createdAt" label="创建时间" width="180">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column v-if="showLowColumns" prop="finishedAt" label="完成时间" width="180">
            <template #default="{ row }">{{ formatDate(row.finishedAt) }}</template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="errorMessage" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="110">
            <template #default="{ row }">
              <el-button size="small" :disabled="row.status !== 'success'" @click="downloadTask(row)">下载</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-footer">
          <span class="muted">共 {{ taskPagination.total }} 个导出任务</span>
          <el-pagination
            v-model:current-page="taskPagination.page"
            v-model:page-size="taskPagination.pageSize"
            background
            small
            layout="sizes, prev, pager, next"
            :page-sizes="[20, 50, 100]"
            :total="taskPagination.total"
            @size-change="handleTaskSize"
            @current-change="handleTaskCurrent"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Download, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

const exportTypes = [
  { label: '考试成绩', value: 'exam_results' },
  { label: '批改记录', value: 'grading' },
  { label: '题库', value: 'question_bank' },
  { label: '试卷库', value: 'papers' },
  { label: '试卷文档', value: 'paper_document' },
  { label: '错题导出', value: 'wrong_questions' },
  { label: '班级', value: 'classes' },
  { label: '统计分析', value: 'statistics' },
];

const activeTab = ref('papers');
const courses = ref([]);
const classes = ref([]);
const papers = ref([]);
const exams = ref([]);
const tasks = ref([]);
const exporting = ref(false);
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const paperFilter = reactive({ keyword: '', courseId: '', status: '', sortBy: 'createdAt', sortOrder: 'desc' });
const examFilter = reactive({ keyword: '', courseId: '', classId: '', status: '', sortBy: 'startTime', sortOrder: 'desc' });
const taskFilter = reactive({ type: '' });
const taskPagination = reactive({ page: 1, pageSize: 20, total: 0 });

async function loadBase() {
  const [coursePage, classPage] = await Promise.all([
    api('/courses?pageSize=100'),
    api('/classes?pageSize=100'),
  ]);
  courses.value = coursePage.items;
  classes.value = classPage.items;
}

async function loadPapers() {
  const data = await api(
    `/papers${buildQuery({
      pageSize: 100,
      keyword: paperFilter.keyword,
      courseId: paperFilter.courseId,
      status: paperFilter.status,
      sortBy: paperFilter.sortBy,
      sortOrder: paperFilter.sortOrder,
    })}`,
  );
  papers.value = data.items;
}

async function loadExams() {
  const data = await api(
    `/exams${buildQuery({
      pageSize: 100,
      keyword: examFilter.keyword,
      courseId: examFilter.courseId,
      classId: examFilter.classId,
      status: examFilter.status,
      sortBy: examFilter.sortBy,
      sortOrder: examFilter.sortOrder,
    })}`,
  );
  exams.value = data.items;
}

async function loadTasks() {
  const data = await api(
    `/exports${buildQuery({
      page: taskPagination.page,
      pageSize: taskPagination.pageSize,
      type: taskFilter.type,
    })}`,
  );
  tasks.value = data.items;
  taskPagination.page = data.page;
  taskPagination.pageSize = data.pageSize;
  taskPagination.total = data.total;
}

async function loadAll() {
  await Promise.all([loadBase(), loadPapers(), loadExams(), loadTasks()]);
}

async function exportPaper(row, command) {
  const configs = {
    'student-pdf': { format: 'pdf', includeAnswers: false, includeAnalysis: false },
    'answer-pdf': { format: 'pdf', includeAnswers: true, includeAnalysis: true },
    'answer-docx': { format: 'docx', includeAnswers: true, includeAnalysis: true },
    'transfer-csv': { format: 'csv', includeAnswers: true, includeAnalysis: true },
    'transfer-json': { format: 'json', includeAnswers: true, includeAnalysis: true },
    'transfer-zip': { format: 'zip', includeAnswers: true, includeAnalysis: true },
  };
  const config = configs[command];
  if (!config) return;
  await directExport({
    type: 'paper_document',
    paperId: row.id,
    ...config,
  });
}

async function exportExam(row, command) {
  const configs = {
    'results-csv': { type: 'exam_results', format: 'csv', examId: row.id },
    'grading-csv': { type: 'grading', format: 'csv', examId: row.id },
    'paper-pdf': { type: 'paper_document', format: 'pdf', paperId: row.paperId, includeAnswers: false, includeAnalysis: false },
    'paper-answer-pdf': { type: 'paper_document', format: 'pdf', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-csv': { type: 'paper_document', format: 'csv', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-json': { type: 'paper_document', format: 'json', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
    'paper-transfer-zip': { type: 'paper_document', format: 'zip', paperId: row.paperId, includeAnswers: true, includeAnalysis: true },
  };
  const config = configs[command];
  if (!config) return;
  if (config.type === 'paper_document' && !config.paperId) {
    ElMessage.error('该考试未关联试卷，无法导出试卷内容');
    return;
  }
  await directExport(config);
}

async function directExport(payload) {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const body = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== ''));
    const task = await api('/exports', { method: 'POST', body });
    ElMessage.success('导出已生成，正在打开文件');
    if (task.fileUrl) window.open(task.fileUrl, '_blank');
    taskPagination.page = 1;
    await loadTasks();
  } catch (error) {
    ElMessage.error(error.message || '导出失败');
  } finally {
    exporting.value = false;
  }
}

async function downloadTask(row) {
  const data = await api(`/exports/${row.id}/download`);
  window.open(data.url, '_blank');
}

function handlePaperSortChange({ prop, order }) {
  paperFilter.sortBy = prop || 'createdAt';
  paperFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadPapers();
}

function handleExamSortChange({ prop, order }) {
  examFilter.sortBy = prop || 'startTime';
  examFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadExams();
}

function handleTaskSize(size) {
  taskPagination.pageSize = size;
  taskPagination.page = 1;
  loadTasks();
}

function handleTaskCurrent(page) {
  taskPagination.page = page;
  loadTasks();
}

function typeLabel(type) {
  return exportTypes.find((item) => item.value === type)?.label ?? type;
}

function statusLabel(status) {
  const map = { success: '成功', failed: '失败', processing: '处理中', pending: '等待中', expired: '已过期' };
  return map[status] ?? status;
}

function paperStatusLabel(value) {
  const map = { draft: '草稿', published: '已发布', archived: '已归档' };
  return map[value] ?? value;
}

function examStatusLabel(value) {
  const map = { draft: '草稿', scheduled: '已安排', running: '进行中', ended: '已结束', archived: '已归档' };
  return map[value] ?? value;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

onMounted(loadAll);
</script>

<style scoped>
.export-workspace {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
}

.export-target-panel {
  flex: 0 0 auto;
  overflow: hidden;
}

.export-filter-row {
  margin-bottom: 12px;
  justify-content: flex-start;
}

.export-field-alert {
  margin-top: 10px;
}

.export-record-panel {
  flex: 1;
  min-height: 280px;
}

.section-head h3 {
  margin: 0 0 4px;
}
</style>
