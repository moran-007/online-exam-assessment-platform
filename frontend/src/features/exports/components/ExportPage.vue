<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">导出中心</h1>
      <div class="toolbar">
        <el-button v-if="canExportFullArchive" type="primary" :loading="exporting" :icon="Download" @click="exportFullArchive">
          一键导出全部
        </el-button>
        <el-button v-if="canManageGlobalTasks" @click="openDownloadAudits">下载审计</el-button>
        <el-button v-if="canManageGlobalTasks" :icon="Delete" @click="cleanupExpired">清理过期</el-button>
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
                <el-option v-for="status in paperStatusOptions" :key="status.value" :label="status.label" :value="status.value" />
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
                  <el-tag :type="paperStatusType(row.status)" effect="plain">{{ paperStatusLabel(row.status) }}</el-tag>
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
                        <el-dropdown-item command="teacher-pdf">PDF 教师讲义</el-dropdown-item>
                        <el-dropdown-item command="answer-book-pdf">PDF 答案册</el-dropdown-item>
                        <el-dropdown-item command="teacher-docx">Word 教师讲义</el-dropdown-item>
                        <el-dropdown-item command="answer-book-docx">Word 答案册</el-dropdown-item>
                        <el-dropdown-item command="transfer-csv">CSV 迁移表</el-dropdown-item>
                        <el-dropdown-item command="transfer-xlsx">Excel 迁移表</el-dropdown-item>
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
                <el-option v-for="status in examStatusOptions" :key="status.value" :label="status.label" :value="status.value" />
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
                  <el-tag :type="examStatusType(row.status)" effect="plain">
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
                        <el-dropdown-item command="results-xlsx">成绩 Excel</el-dropdown-item>
                        <el-dropdown-item command="grading-csv">批改记录 CSV</el-dropdown-item>
                        <el-dropdown-item command="paper-pdf">试卷 PDF 学生版</el-dropdown-item>
                        <el-dropdown-item command="paper-teacher-pdf">试卷 PDF 教师讲义</el-dropdown-item>
                        <el-dropdown-item command="paper-answer-book-pdf">试卷 PDF 答案册</el-dropdown-item>
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
          <div class="toolbar export-task-toolbar">
            <el-select v-model="taskFilter.scope" placeholder="范围" style="width: 116px" @change="loadTasks">
              <el-option label="我的任务" value="mine" />
              <el-option v-if="canManageGlobalTasks" label="全部任务" value="all" />
            </el-select>
            <el-select v-model="taskFilter.type" clearable placeholder="记录类型" style="width: 150px" @change="loadTasks">
              <el-option v-for="item in exportTypes" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-select v-model="taskFilter.status" clearable placeholder="状态" style="width: 128px" @change="loadTasks">
              <el-option label="等待中" value="pending" />
              <el-option label="处理中" value="processing" />
              <el-option label="成功" value="success" />
              <el-option label="失败" value="failed" />
              <el-option label="已取消" value="canceled" />
              <el-option label="已过期" value="expired" />
            </el-select>
            <el-button type="warning" plain :disabled="!selectedTaskIds.length" @click="cancelSelectedTasks">
              批量取消
            </el-button>
            <el-button type="warning" plain :disabled="!selectedRetryTaskIds.length" @click="retrySelectedTasks">
              批量重试
            </el-button>
          </div>
        </div>
        <el-table :data="tasks" height="100%" class="question-list-table" @selection-change="handleTaskSelectionChange">
          <el-table-column type="selection" width="46" :selectable="canSelectTaskAction" />
          <el-table-column prop="type" label="类型" min-width="130">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <ExportTaskStatus :status="row.status" />
            </template>
          </el-table-column>
          <el-table-column prop="progress" label="进度" width="150">
            <template #default="{ row }">
              <el-progress :percentage="Number(row.progress || 0)" :stroke-width="8" :show-text="false" />
              <span class="mini-muted">{{ Number(row.progress || 0) }}%</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="retryCount" label="重试" width="76" />
          <el-table-column v-if="showMediumColumns" prop="createdAt" label="创建时间" width="180">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column v-if="showLowColumns" prop="finishedAt" label="完成时间" width="180">
            <template #default="{ row }">{{ formatDate(row.finishedAt) }}</template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" prop="errorMessage" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column label="操作" width="110">
            <template #default="{ row }">
              <div class="toolbar tiny-actions">
                <el-button size="small" :disabled="row.status !== 'success'" @click="downloadTask(row)">下载</el-button>
                <el-button v-if="canCancel(row)" size="small" type="warning" plain @click="cancelTask(row)">
                  取消
                </el-button>
                <el-button v-if="canRetry(row)" size="small" type="warning" plain @click="retryTask(row)">
                  重试
                </el-button>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-footer">
          <span class="muted">共 {{ taskPagination.total }} 个导出任务</span>
        <el-pagination
          v-model:current-page="taskPagination.page"
          v-model:page-size="taskPagination.pageSize"
          background
          size="small"
          layout="sizes, prev, pager, next"
            :page-sizes="[20, 50, 100]"
            :total="taskPagination.total"
            @size-change="handleTaskSize"
            @current-change="handleTaskCurrent"
          />
        </div>
      </div>
    </div>

    <el-dialog v-model="auditVisible" title="下载审计" width="880px" class="responsive-dialog">
      <el-table v-loading="auditLoading" :data="auditLogs" max-height="520" class="question-list-table">
        <el-table-column prop="downloadedAt" label="下载时间" width="170">
          <template #default="{ row }">{{ formatDate(row.downloadedAt) }}</template>
        </el-table-column>
        <el-table-column label="下载人" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ auditUserLabel(row.downloadedBy) }}</template>
        </el-table-column>
        <el-table-column prop="type" label="任务类型" width="120">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column prop="taskStatus" label="任务状态" width="100">
          <template #default="{ row }">{{ statusLabel(row.taskStatus) }}</template>
        </el-table-column>
        <el-table-column label="权限快照" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            {{ snapshotLabel(row.permissionSnapshot) }}
          </template>
        </el-table-column>
        <el-table-column prop="fileUrl" label="文件" min-width="220" show-overflow-tooltip />
      </el-table>
      <div class="table-footer">
        <span class="muted">共 {{ auditPagination.total }} 条下载记录</span>
        <el-pagination
          v-model:current-page="auditPagination.page"
          v-model:page-size="auditPagination.pageSize"
          background
          size="small"
          layout="sizes, prev, pager, next"
          :page-sizes="[20, 50, 100]"
          :total="auditPagination.total"
          @size-change="handleAuditSize"
          @current-change="handleAuditCurrent"
        />
      </div>
    </el-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useExportPage } from '../composables/useExportPage';
import ExportTaskStatus from './ExportTaskStatus.vue';

export default defineComponent({
  name: 'ExportPage',
  components: { ExportTaskStatus },
  setup() {
    const context = useExportPage();
    return context;
  },
});
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

.tiny-actions {
  gap: 6px;
}

.mini-muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
