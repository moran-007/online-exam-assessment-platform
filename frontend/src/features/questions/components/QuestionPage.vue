<template>
  <div class="page">
    <div class="page-head question-page-head">
      <h1 class="page-title">题库管理</h1>
      <div class="toolbar question-toolbar">
        <el-input
          v-model="filter.keyword"
          clearable
          placeholder="题目关键词"
          style="width: 180px"
          @keyup.enter="loadFirstPage"
          @clear="loadFirstPage"
        />
        <el-select v-model="filter.courseId" clearable placeholder="课程" style="width: 170px" @change="handleFilterCourseChange">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-tree-select
          v-model="filter.knowledgePointId"
          :data="filterKnowledgeTreeOptions"
          check-strictly
          clearable
          filterable
          placeholder="知识点"
          style="width: 180px"
          :disabled="!filter.courseId"
          @change="loadFirstPage"
        />
        <el-select v-model="filter.tagId" clearable filterable placeholder="标签" style="width: 170px" @change="loadFirstPage">
          <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.id" />
        </el-select>
        <el-select v-model="filter.type" clearable placeholder="题型" style="width: 130px" @change="loadFirstPage">
          <el-option v-for="type in typeOptions" :key="type.value" :label="type.label" :value="type.value" />
        </el-select>
        <el-switch
          v-model="editMode"
          active-text="编辑模式"
          inactive-text="答题模式"
          inline-prompt
          style="--el-switch-on-color: #d97706; --el-switch-off-color: #256f78"
          @change="onEditModeChange"
        />
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="refreshAll">刷新</el-button>
        <el-button v-if="editMode" :icon="Upload" @click="router.push('/question-import')">题目导入</el-button>
        <template v-if="editMode">
          <el-select v-model="bulkQuestionStatus" clearable placeholder="批量状态" style="width: 132px">
            <el-option v-for="status in statusOptions" :key="status.value" :label="status.label" :value="status.value" />
          </el-select>
          <el-button
            :icon="Check"
            :disabled="!selectedQuestionIds.length || !bulkQuestionStatus"
            @click="bulkUpdateQuestionStatus"
          >
            批量设置
          </el-button>
          <el-button
            :icon="Download"
            :disabled="!selectedQuestionIds.length"
            @click="openQuestionExportDialog(selectedQuestionIds)"
          >
            导出选中
          </el-button>
        </template>
        <el-button
          v-if="editMode"
          type="danger"
          plain
          :icon="Delete"
          :disabled="!selectedQuestionIds.length"
          @click="bulkDeleteQuestions"
        >
          批量删除
        </el-button>
      </div>
    </div>

    <div class="question-list-only">
      <el-tabs v-model="questionScope" class="page-tabs" @tab-change="loadFirstPage">
        <el-tab-pane label="考试中" name="occupied" />
        <el-tab-pane label="已公开" name="published" />
        <el-tab-pane label="草稿" name="draft" />
      </el-tabs>
      <QuestionEditorDialog />

      <div class="panel question-table-panel">
        <el-table
          class="question-list-table"
          :data="items"
          height="100%"
          :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
          highlight-current-row
          @row-click="handleQuestionRowClick"
          @selection-change="handleSelectionChange"
          @sort-change="handleQuestionSortChange"
        >
          <el-table-column v-if="editMode" type="selection" width="48" />
          <el-table-column prop="title" label="题目" min-width="300" sortable="custom">
            <template #default="{ row }">
              <div class="question-title-cell">
                <strong>{{ row.title }}</strong>
                <el-tag
                  v-if="row.occupiedByExam"
                  size="small"
                  type="warning"
                  class="clickable-tag"
                  @click.stop="openRelatedExams(row)"
                >
                  比赛占用
                </el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="type" label="题型" width="96" sortable="custom">
            <template #default="{ row }">{{ typeLabel(row.type) }}</template>
          </el-table-column>
          <el-table-column prop="difficulty" label="难度" width="74" sortable="custom" />
          <el-table-column v-if="showMediumColumns" prop="defaultScore" label="分值" width="74" sortable="custom" />
          <el-table-column v-if="showMediumColumns" label="知识点" min-width="120">
            <template #default="{ row }">
              <div class="table-tag-list">
                <el-tag
                  v-for="point in row.knowledgePoints || []"
                  :key="point.id"
                  size="small"
                  type="success"
                  effect="plain"
                  class="clickable-tag"
                  @click.stop="filterByKnowledgePoint(point)"
                >
                  {{ point.name }}
                </el-tag>
                <span v-if="!(row.knowledgePoints || []).length" class="muted">-</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="showMediumColumns" label="标签" min-width="120">
            <template #default="{ row }">
              <div class="table-tag-list">
                <el-tag
                  v-for="tag in row.tags || []"
                  :key="tag.id"
                  size="small"
                  effect="plain"
                  class="clickable-tag"
                  @click.stop="filterByTag(tag)"
                >
                  {{ tag.name }}
                </el-tag>
                <span v-if="!(row.tags || []).length" class="muted">-</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="86" sortable="custom">
            <template #default="{ row }">
              <el-tag :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="showLowColumns" prop="createdAt" label="录入时间" width="148" sortable="custom">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="96" fixed="right">
            <template #default="{ row }">
              <div class="question-actions row-action-cell" @click.stop @mousedown.stop>
                <template v-if="!editMode">
                  <el-button size="small" :icon="View" @click.stop="openPracticeQuestion(row)">答题</el-button>
                </template>
                <template v-else>
                  <el-dropdown trigger="click" @command="(command) => handleQuestionCommand(row, command)">
                    <el-button size="small" :icon="MoreFilled" @click.stop>操作</el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="edit" :icon="Edit">编辑/复制</el-dropdown-item>
                        <el-dropdown-item v-if="row.status !== 'published'" command="publish" :icon="Check">发布</el-dropdown-item>
                        <el-dropdown-item v-if="row.status === 'published'" command="unpublish" :icon="Close">取消发布</el-dropdown-item>
                        <el-dropdown-item v-if="row.status !== 'disabled'" command="hide" :icon="Hide">隐藏</el-dropdown-item>
                        <el-dropdown-item v-if="row.status === 'disabled'" command="show" :icon="View">显示</el-dropdown-item>
                        <el-dropdown-item command="download" :icon="Download">下载</el-dropdown-item>
                        <el-dropdown-item command="delete" :icon="Delete" divided>删除</el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </template>
              </div>
            </template>
          </el-table-column>
        </el-table>
        <div class="table-footer question-table-footer">
          <span class="muted">共 {{ pagination.total }} 道题</span>
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.pageSize"
            background
            size="small"
            :pager-count="5"
            layout="sizes, prev, pager, next"
            :page-sizes="pageSizes"
            :total="pagination.total"
            @size-change="handleSizeChange"
            @current-change="handleCurrentChange"
          />
        </div>
      </div>
    </div>

    <QuestionPracticeDialog />

    <QuestionExportDialog />
</div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionPage } from '../composables/useQuestionPage';
import { provideQuestionPageContext } from '../composables/questionPageContext';
import QuestionEditorDialog from './QuestionEditorDialog.vue';
import QuestionPracticeDialog from './QuestionPracticeDialog.vue';
import QuestionExportDialog from './QuestionExportDialog.vue';

export default defineComponent({
  name: 'QuestionPage',
  components: { QuestionEditorDialog, QuestionPracticeDialog, QuestionExportDialog },
  setup() {
    const context = useQuestionPage();
    provideQuestionPageContext(context);
    return context;
  },
});
</script>
