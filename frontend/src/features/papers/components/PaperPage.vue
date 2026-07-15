<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">试卷管理</h1>
      <div class="toolbar">
        <el-input
          v-model="paperFilter.keyword"
          clearable
          placeholder="试卷关键词"
          style="width: 180px"
          @keyup.enter="loadFirstPaperPage"
          @clear="loadFirstPaperPage"
        />
        <el-select v-model="paperFilter.courseId" clearable placeholder="课程" style="width: 170px" @change="loadFirstPaperPage">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-button type="primary" :icon="Plus" @click="createPaperVisible = true">新建试卷</el-button>
        <el-upload
          :key="paperImportUploadKey"
          accept=".json,.zip"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="handlePaperImportChange"
        >
          <el-button :icon="Upload" :loading="paperImporting">导入试卷</el-button>
        </el-upload>
        <el-button :icon="Plus" @click="openWrongFrequencyDialog">高频错题组卷</el-button>
        <el-button :icon="Edit" :disabled="!detail" @click="openPaperEditor()">调整当前试卷</el-button>
        <el-button :icon="DocumentCopy" :disabled="!detail" @click="copyPaperAsDraft()">复制为草稿</el-button>
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <div class="status-guide">
      <div v-for="status in paperStatusOptions" :key="status.value" class="status-guide-item">
        <el-tag :type="status.type" effect="plain">{{ status.label }}</el-tag>
        <span>{{ status.description }}</span>
      </div>
      <div class="status-guide-note">
        试卷与考试关系：只有“已公开”试卷可创建考试；学生题库仅展示已公开且未被考试占用的试卷。
      </div>
    </div>

    <el-tabs v-model="paperScope" class="page-tabs" @tab-change="loadFirstPaperPage">
      <el-tab-pane label="考试中" name="occupied" />
      <el-tab-pane label="已公开" name="published" />
      <el-tab-pane label="草稿" name="draft" />
      <el-tab-pane label="已归档" name="archived" />
    </el-tabs>

    <div class="paper-layout">
      <main class="paper-main">
        <div class="panel library-table-panel paper-library-panel">
          <div class="paper-library-head">
            <div>
              <h3>试卷库</h3>
              <span class="muted">使用上方标签查看试卷分类；新建试卷默认按录入时间排在最前。</span>
            </div>
          </div>
          <el-table
            :data="papers"
            height="100%"
            highlight-current-row
            class="question-list-table"
            :default-sort="{ prop: paperFilter.sortBy, order: paperFilter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
            @row-click="previewPaper"
            @current-change="selectPaper"
            @sort-change="handlePaperSortChange"
          >
            <el-table-column prop="name" label="试卷" min-width="220" sortable="custom" />
            <el-table-column v-if="showMediumColumns" prop="courseName" label="课程" width="140" />
            <el-table-column prop="questionCount" label="题数" width="80" />
            <el-table-column v-if="showMediumColumns" prop="totalScore" label="总分" width="86" sortable="custom" />
            <el-table-column v-if="showMediumColumns" prop="durationMinutes" label="时长" width="86" sortable="custom" />
            <el-table-column prop="status" label="状态" width="128" sortable="custom">
              <template #default="{ row }">
                <div class="row-action-cell" @click.stop @mousedown.stop>
                  <el-dropdown trigger="click" @command="(status) => changePaperStatus(row, status)">
                    <el-tag class="status-action-tag" :type="statusTagType('paper', row.status)" effect="plain">
                      {{ statusLabel('paper', row.status) }}
                    </el-tag>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item
                          v-for="status in paperStatusTargets(row)"
                          :key="status.value"
                          :command="status.value"
                        >
                          {{ paperStatusActionText(row.status, status.value) }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="examUsageCount" label="进行中占用" width="128">
              <template #default="{ row }">
                <el-tag :type="examUsageType(row)" effect="plain">
                  {{ examUsageLabel(row) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="showLowColumns" prop="createdAt" label="录入时间" width="170" sortable="custom">
              <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <div class="question-actions row-action-cell" @click.stop @mousedown.stop>
                  <el-dropdown trigger="click" @command="(command) => handlePaperCommand(row, command)">
                    <el-button size="small" @click.stop>操作</el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="preview">预览</el-dropdown-item>
                        <el-dropdown-item command="edit">调整</el-dropdown-item>
                        <el-dropdown-item command="answer">试答</el-dropdown-item>
                        <el-dropdown-item command="copy">复制为草稿</el-dropdown-item>
                        <el-dropdown-item
                          v-for="status in paperStatusTargets(row)"
                          :key="status.value"
                          :command="`status:${status.value}`"
                        >
                          {{ paperStatusActionText(row.status, status.value) }}
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
              </template>
            </el-table-column>
          </el-table>
          <div class="table-footer">
            <span class="muted">共 {{ paperPagination.total }} 份试卷</span>
            <el-pagination
              v-model:current-page="paperPagination.page"
              v-model:page-size="paperPagination.pageSize"
              background
              size="small"
              :pager-count="5"
              layout="sizes, prev, pager, next"
              :page-sizes="pageSizes"
              :total="paperPagination.total"
              @size-change="handlePaperSizeChange"
              @current-change="handlePaperCurrentChange"
            />
          </div>
        </div>
      </main>
    </div>

    <el-dialog v-model="createPaperVisible" title="新建试卷" width="520px" destroy-on-close>
      <el-form :model="form" label-width="72px">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="请输入试卷名称" />
        </el-form-item>
        <el-form-item label="课程">
          <el-select v-model="form.courseId" style="width: 100%">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="时长">
          <el-input-number v-model="form.durationMinutes" :min="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createPaperVisible = false">取消</el-button>
        <el-button type="primary" :icon="Plus" @click="createPaper">创建并预览</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="wrongFrequencyVisible" title="按错题频次组卷" width="560px" destroy-on-close>
      <el-form :model="wrongFrequencyForm" label-width="96px">
        <el-form-item label="试卷名称">
          <el-input v-model="wrongFrequencyForm.name" placeholder="留空将自动生成名称" />
        </el-form-item>
        <el-form-item label="课程">
          <el-select v-model="wrongFrequencyForm.courseId" filterable style="width: 100%">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="题型">
          <el-select v-model="wrongFrequencyForm.questionType" clearable placeholder="不限" style="width: 100%">
            <el-option label="单选题" value="single_choice" />
            <el-option label="多选题" value="multiple_choice" />
            <el-option label="判断题" value="true_false" />
            <el-option label="填空题" value="fill_blank" />
            <el-option label="简答题" value="short_answer" />
            <el-option label="编程题" value="programming" />
          </el-select>
        </el-form-item>
        <el-form-item label="分区名称">
          <el-input v-model="wrongFrequencyForm.sectionTitle" />
        </el-form-item>
        <el-form-item label="题目数量">
          <el-input-number v-model="wrongFrequencyForm.count" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="最低错次">
          <el-input-number v-model="wrongFrequencyForm.minWrongCount" :min="1" />
        </el-form-item>
        <el-form-item label="每题分值">
          <el-input-number v-model="wrongFrequencyForm.scoreEach" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="wrongFrequencyVisible = false">取消</el-button>
        <el-button type="primary" :icon="Plus" @click="generateWrongFrequencyPaper">生成试卷</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="paperEditorVisible" :title="detail ? `调整试卷：${safeDetail.name}` : '调整试卷'" size="560px" destroy-on-close>
      <el-empty v-if="!detail" description="请先从试卷库选择一份试卷" />
      <el-tabs v-else v-model="paperEditorTab" class="paper-editor-tabs">
        <el-tab-pane label="试卷信息" name="info">
          <div class="paper-tool-head">
            <h3>试卷信息</h3>
            <div class="status-inline">
              <el-tag :type="statusTagType('paper', safeDetail.status)" effect="plain">
                {{ statusLabel('paper', safeDetail.status) }}
              </el-tag>
              <el-tag :type="examUsageType(detail)" effect="plain">
                {{ examUsageLabel(detail) }}
              </el-tag>
              <span class="muted">{{ paperCurrentStatusDescription }}</span>
            </div>
          </div>
          <el-form :model="editPaperForm" label-width="72px">
            <el-form-item label="名称">
              <el-input v-model="editPaperForm.name" :disabled="!canEditPaper" />
            </el-form-item>
            <el-form-item label="课程">
              <el-select v-model="editPaperForm.courseId" :disabled="!canEditPaper" style="width: 100%">
                <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="时长">
              <el-input-number v-model="editPaperForm.durationMinutes" :min="1" :disabled="!canEditPaper" />
            </el-form-item>
            <el-form-item label="随机">
              <el-checkbox v-model="editPaperForm.shuffleQuestions" :disabled="!canEditPaper">题目顺序随机</el-checkbox>
              <el-checkbox v-model="editPaperForm.shuffleOptions" :disabled="!canEditPaper">选项顺序随机</el-checkbox>
            </el-form-item>
            <el-form-item label="状态">
              <div class="status-control-row">
                <el-select
                  :model-value="safeDetail.status"
                  placeholder="试卷状态"
                  style="width: 180px"
                  @change="(status) => changePaperStatus(detail, status)"
                >
                  <el-option
                    v-for="status in paperStatusOptions"
                    :key="status.value"
                    :label="status.label"
                    :value="status.value"
                  />
                </el-select>
                <span class="muted">{{ paperCurrentStatusDescription }}</span>
              </div>
            </el-form-item>
            <div class="toolbar">
              <el-button type="primary" :icon="Edit" :disabled="!canEditPaper" @click="savePaperInfo">保存试卷</el-button>
              <el-button v-if="safeDetail.status === 'published'" :icon="Close" @click="unpublishPaper">转回草稿</el-button>
            </div>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="手动加题" name="manual">
          <el-form :model="addForm" label-width="72px">
            <el-form-item label="题目">
              <el-select v-model="addForm.questionId" filterable style="width: 100%" @change="syncSelectedQuestionScore">
                <el-option v-for="question in questions" :key="question.id" :label="question.title" :value="question.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="分区">
              <el-input v-model="addForm.sectionTitle" />
            </el-form-item>
            <el-form-item label="分值">
              <el-input-number v-model="addForm.score" :min="0" />
            </el-form-item>
            <div class="toolbar">
              <el-button :icon="Plus" :disabled="!canEditPaper" @click="addQuestion">加入试卷</el-button>
              <el-button type="success" :icon="Check" :disabled="!detail || safeDetail.status === 'published'" @click="publishPaper">
                公开试卷
              </el-button>
            </div>
          </el-form>
          <p v-if="detail && !canEditPaper" class="muted paper-tip">已公开试卷只可查看；如需大改，建议复制为新草稿后调整。</p>
        </el-tab-pane>

        <el-tab-pane label="条件组卷" name="bulk">
          <el-form :model="bulkForm" label-width="72px">
            <el-form-item label="大类">
              <el-select v-model="bulkForm.courseId" clearable filterable placeholder="默认当前试卷课程" style="width: 100%" @change="handleBulkCourseChange">
                <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="知识点">
              <el-tree-select
                v-model="bulkForm.knowledgePointIds"
                :data="bulkKnowledgeTreeOptions"
                multiple
                check-strictly
                collapse-tags
                collapse-tags-tooltip
                clearable
                filterable
                placeholder="不限知识点"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="标签">
              <el-select v-model="bulkForm.tagIds" multiple filterable style="width: 100%">
                <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="题型">
              <el-select v-model="bulkForm.questionType" clearable placeholder="不限" style="width: 100%">
                <el-option label="单选题" value="single_choice" />
                <el-option label="多选题" value="multiple_choice" />
                <el-option label="判断题" value="true_false" />
                <el-option label="填空题" value="fill_blank" />
                <el-option label="简答题" value="short_answer" />
                <el-option label="编程题" value="programming" />
              </el-select>
            </el-form-item>
            <el-form-item label="分区">
              <el-input v-model="bulkForm.sectionTitle" />
            </el-form-item>
            <el-form-item label="分值">
              <el-input-number v-model="bulkForm.scoreEach" :min="0" />
            </el-form-item>
            <el-form-item label="随机">
              <el-switch v-model="bulkForm.random" />
            </el-form-item>
            <el-form-item v-if="bulkForm.random" label="数量">
              <el-input-number v-model="bulkForm.count" :min="1" />
            </el-form-item>
            <el-button :icon="Plus" :disabled="!canEditPaper" @click="addQuestionsByTags">
              {{ bulkForm.random ? '随机加入' : '批量加入' }}
            </el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </el-drawer>

    <el-drawer v-model="paperPreviewVisible" :title="detail ? `试卷预览：${safeDetail.name}` : '试卷预览'" size="72%" destroy-on-close>
      <div v-if="detail" class="paper-preview">
        <div class="paper-preview-head">
          <div>
            <h2>{{ safeDetail.name }}</h2>
            <span class="muted">{{ safeDetail.course?.name || safeDetail.courseName }} · {{ safeDetail.durationMinutes }} 分钟</span>
          </div>
          <div class="toolbar">
            <el-tag>{{ totalQuestionCount }} 题</el-tag>
            <el-tag type="success">{{ safeDetail.totalScore }} 分</el-tag>
            <el-tag :type="statusTagType('paper', safeDetail.status)" effect="plain">
              {{ statusLabel('paper', safeDetail.status) }}
            </el-tag>
            <el-tag :type="examUsageType(detail)" effect="plain">
              {{ examUsageLabel(detail) }}
            </el-tag>
            <el-tag v-if="safeDetail.shuffleQuestions" type="warning">题目随机已启用</el-tag>
            <el-tag v-if="safeDetail.shuffleOptions" type="warning">选项随机已启用</el-tag>
            <el-button :icon="Edit" @click="paperEditorVisible = true">调整试卷</el-button>
            <el-button :icon="DocumentCopy" @click="copyPaperAsDraft()">复制为草稿</el-button>
            <el-button :icon="Check" @click="answerPaper()">试答试卷</el-button>
          </div>
        </div>

        <el-empty v-if="!displaySections.length" description="暂无题目，请先加入题目" />

        <section v-for="section in displaySections" :key="section.key" class="paper-section">
          <div class="paper-section-head">
            <h3>{{ section.title }}</h3>
            <span>{{ section.questions.length }} 题 / {{ section.score }} 分</span>
          </div>
          <el-collapse>
            <el-collapse-item v-for="(paperQuestion, index) in section.questions" :key="paperQuestion.id" :name="paperQuestion.id">
              <template #title>
                <div class="paper-question-title">
                  <span>{{ index + 1 }}. {{ snapshot(paperQuestion).title }}</span>
                  <span>{{ paperQuestion.score }} 分</span>
                </div>
              </template>
              <div class="paper-question-body">
                <div class="paper-question-meta">
                  <el-tag>{{ snapshot(paperQuestion).type }}</el-tag>
                  <el-tag type="info">排序 {{ paperQuestion.sortOrder }}</el-tag>
                  <el-button size="small" :icon="Edit" :disabled="!canEditSnapshot" @click.stop="openSnapshotEditor(paperQuestion)">
                    编辑显示
                  </el-button>
                  <el-button size="small" type="danger" plain :icon="Delete" :disabled="!canEditPaper" @click.stop="removeQuestion(paperQuestion)">
                    删除
                  </el-button>
                </div>
                <MarkdownRenderer :source="snapshot(paperQuestion).content || ''" />
                <div v-if="snapshot(paperQuestion).options?.length" class="paper-option-list">
                  <div
                    v-for="option in snapshot(paperQuestion).options"
                    :key="option.id"
                    :class="['paper-option', option.isCorrect ? 'correct' : '']"
                  >
                    <strong>{{ option.optionKey }}.</strong>
                    <MarkdownRenderer :source="option.content" />
                    <span v-if="option.isCorrect" class="answer-mark success">正确答案</span>
                  </div>
                </div>
                <div v-if="snapshot(paperQuestion).analysis" class="paper-analysis">
                  <strong>解析</strong>
                  <MarkdownRenderer :source="snapshot(paperQuestion).analysis" />
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </section>
      </div>
      <el-empty v-else description="请先选择试卷" />
    </el-drawer>

    <el-dialog v-model="snapshotEditorVisible" title="编辑试卷内显示内容" width="920px" destroy-on-close>
      <div class="snapshot-editor">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          title="只修改当前试卷内的题目显示快照，不会改动原题库；已有学生进入或提交后将被系统拦截。"
        />
        <el-form :model="snapshotForm" label-width="84px">
          <el-form-item label="题目标题">
            <el-input v-model="snapshotForm.title" maxlength="256" show-word-limit />
          </el-form-item>
          <div class="snapshot-editor-grid">
            <div class="snapshot-editor-form">
              <el-form-item label="题干">
                <el-input v-model="snapshotForm.content" type="textarea" :rows="12" />
              </el-form-item>
              <el-form-item v-if="snapshotForm.options.length" label="选项">
                <div class="snapshot-options-editor">
                  <div v-for="(option, index) in snapshotForm.options" :key="option.id || index" class="snapshot-option-editor">
                    <el-input v-model="option.optionKey" class="snapshot-option-key" maxlength="16" />
                    <el-input v-model="option.content" type="textarea" :rows="3" />
                    <el-tag v-if="option.isCorrect" type="success">原正确项</el-tag>
                  </div>
                </div>
              </el-form-item>
              <el-form-item label="解析">
                <el-input v-model="snapshotForm.analysis" type="textarea" :rows="5" />
              </el-form-item>
            </div>
            <div class="snapshot-preview">
              <div class="snapshot-preview-title">{{ snapshotForm.title || '题目预览' }}</div>
              <MarkdownRenderer :source="snapshotForm.content || ''" />
              <div v-if="snapshotForm.options.length" class="paper-option-list">
                <div
                  v-for="(option, index) in snapshotForm.options"
                  :key="option.id || index"
                  :class="['paper-option', option.isCorrect ? 'correct' : '']"
                >
                  <strong>{{ option.optionKey || String.fromCharCode(65 + index) }}.</strong>
                  <MarkdownRenderer :source="option.content || ''" />
                  <span v-if="option.isCorrect" class="answer-mark success">原正确答案</span>
                </div>
              </div>
              <div v-if="snapshotForm.analysis" class="paper-analysis">
                <strong>解析</strong>
                <MarkdownRenderer :source="snapshotForm.analysis" />
              </div>
            </div>
          </div>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="snapshotEditorVisible = false">取消</el-button>
        <el-button type="primary" :loading="snapshotSaving" @click="saveSnapshotDisplay">保存显示内容</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { usePaperPage } from '../composables/usePaperPage';

export default defineComponent({
  name: 'PaperPage',
  setup: usePaperPage,
});
</script>
