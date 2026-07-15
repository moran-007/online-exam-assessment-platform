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

<script lang="ts">
import { defineComponent } from 'vue';
import { useExamManagementPage } from '../composables/useExamManagementPage';

export default defineComponent({
  name: 'ExamManagementPage',
  setup() {
    const context = useExamManagementPage();
    return context;
  },
});
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
