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
        <el-select v-model="paperFilter.status" clearable placeholder="状态" style="width: 130px" @change="loadFirstPaperPage">
          <el-option v-for="status in paperStatusOptions" :key="status.value" :label="status.label" :value="status.value" />
        </el-select>
        <el-button type="primary" :icon="Plus" @click="createPaperVisible = true">新建试卷</el-button>
        <el-button :icon="Plus" @click="openWrongFrequencyDialog">高频错题组卷</el-button>
        <el-button :icon="Edit" :disabled="!detail" @click="openPaperEditor()">调整当前试卷</el-button>
        <el-button :icon="DocumentCopy" :disabled="!detail" @click="copyPaperAsDraft()">复制为草稿</el-button>
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <div class="paper-layout">
      <main class="paper-main">
        <div class="panel library-table-panel paper-library-panel">
          <div class="paper-library-head">
            <div>
              <h3>试卷库</h3>
              <span class="muted">使用上方课程筛选选择试卷分类；新建试卷默认按录入时间排在最前。</span>
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
            <el-table-column prop="status" label="状态" width="100" sortable="custom" />
            <el-table-column v-if="showLowColumns" prop="createdAt" label="录入时间" width="170" sortable="custom">
              <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100">
              <template #default="{ row }">
                <div class="question-actions">
                  <el-dropdown trigger="click" @command="(command) => handlePaperCommand(row, command)" @click.stop>
                    <el-button size="small">操作</el-button>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item command="preview">预览</el-dropdown-item>
                        <el-dropdown-item command="edit">调整</el-dropdown-item>
                        <el-dropdown-item command="answer">试答</el-dropdown-item>
                        <el-dropdown-item command="copy">复制为草稿</el-dropdown-item>
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
              small
              :pager-count="5"
              layout="sizes, prev, pager, next"
              :page-sizes="pageSizes"
              :total="paperPagination.total"
              @size-change="handlePaperSizeChange"
              @current-change="handlePaperCurrentChange"
            />
          </div>
        </div>

        <div v-if="false && detail" class="panel paper-preview">
          <div class="paper-preview-head">
            <div>
              <h2>{{ detail.name }}</h2>
              <span class="muted">{{ detail.course?.name || detail.courseName }} · {{ detail.durationMinutes }} 分钟</span>
            </div>
            <div class="toolbar">
              <el-tag>{{ totalQuestionCount }} 题</el-tag>
              <el-tag type="success">{{ detail.totalScore }} 分</el-tag>
              <el-tag :type="canEditPaper ? 'warning' : 'info'">{{ detail.status }}</el-tag>
              <el-tag v-if="detail.shuffleQuestions" type="warning">题目随机已启用</el-tag>
              <el-tag v-if="detail.shuffleOptions" type="warning">选项随机已启用</el-tag>
              <el-button :icon="Check" @click="answerPaper">试答试卷</el-button>
            </div>
          </div>

          <el-empty v-if="!displaySections.length" description="暂无题目，先从左侧加入题目" />

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
                    <el-input
                      v-model="paperQuestion.editSectionTitle"
                      size="small"
                      placeholder="分区"
                      style="width: 140px"
                      :disabled="!canEditPaper"
                    />
                    <el-input-number
                      v-model="paperQuestion.editScore"
                      size="small"
                      :min="0"
                      :disabled="!canEditPaper"
                      style="width: 110px"
                    />
                    <el-button size="small" :icon="Top" :disabled="!canEditPaper" @click.stop="moveQuestion(paperQuestion, 'up')">
                      上移
                    </el-button>
                    <el-button size="small" :icon="Bottom" :disabled="!canEditPaper" @click.stop="moveQuestion(paperQuestion, 'down')">
                      下移
                    </el-button>
                    <el-button
                      size="small"
                      :icon="Edit"
                      :disabled="!canEditPaper"
                      @click.stop="updatePaperQuestion(paperQuestion)"
                    >
                      保存调整
                    </el-button>
                    <el-tooltip :content="snapshotEditTip" placement="top" :disabled="canEditSnapshot">
                      <span>
                        <el-button
                          size="small"
                          :icon="Edit"
                          :disabled="!canEditSnapshot"
                          @click.stop="openSnapshotEditor(paperQuestion)"
                        >
                          编辑显示
                        </el-button>
                      </span>
                    </el-tooltip>
                    <el-button
                      size="small"
                      type="danger"
                      :icon="Delete"
                      :disabled="!canEditPaper"
                      @click.stop="removeQuestion(paperQuestion)"
                    >
                      删除题目
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

    <el-drawer v-model="paperEditorVisible" :title="detail ? `调整试卷：${detail.name}` : '调整试卷'" size="560px" destroy-on-close>
      <el-empty v-if="!detail" description="请先从试卷库选择一份试卷" />
      <el-tabs v-else v-model="paperEditorTab" class="paper-editor-tabs">
        <el-tab-pane label="试卷信息" name="info">
          <div class="paper-tool-head">
            <h3>试卷信息</h3>
            <el-tag :type="canEditPaper ? 'warning' : 'success'">{{ detail.status }}</el-tag>
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
            <div class="toolbar">
              <el-button type="primary" :icon="Edit" :disabled="!canEditPaper" @click="savePaperInfo">保存试卷</el-button>
              <el-button v-if="detail.status === 'published'" :icon="Close" @click="unpublishPaper">取消发布</el-button>
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
              <el-button type="success" :icon="Check" :disabled="!detail || detail.status === 'published'" @click="publishPaper">
                发布试卷
              </el-button>
            </div>
          </el-form>
          <p v-if="detail && !canEditPaper" class="muted paper-tip">已发布试卷只可查看；如需大改，建议复制为新草稿后调整。</p>
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

    <el-drawer v-model="paperPreviewVisible" :title="detail ? `试卷预览：${detail.name}` : '试卷预览'" size="72%" destroy-on-close>
      <div v-if="detail" class="paper-preview">
        <div class="paper-preview-head">
          <div>
            <h2>{{ detail.name }}</h2>
            <span class="muted">{{ detail.course?.name || detail.courseName }} · {{ detail.durationMinutes }} 分钟</span>
          </div>
          <div class="toolbar">
            <el-tag>{{ totalQuestionCount }} 题</el-tag>
            <el-tag type="success">{{ detail.totalScore }} 分</el-tag>
            <el-tag :type="canEditPaper ? 'warning' : 'info'">{{ detail.status }}</el-tag>
            <el-tag v-if="detail.shuffleQuestions" type="warning">题目随机已启用</el-tag>
            <el-tag v-if="detail.shuffleOptions" type="warning">选项随机已启用</el-tag>
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

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Bottom, Check, Close, Delete, DocumentCopy, Edit, Plus, Refresh, Top, View } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';
import MarkdownRenderer from '../components/MarkdownRenderer.vue';
import { useResponsiveColumns } from '../composables/useResponsiveColumns';

const router = useRouter();
const courses = ref([]);
const papers = ref([]);
const questions = ref([]);
const tags = ref([]);
const bulkKnowledgeTree = ref([]);
const { showMediumColumns, showLowColumns } = useResponsiveColumns();
const detail = ref(null);
const selectedPaperId = ref('');
const createPaperVisible = ref(false);
const wrongFrequencyVisible = ref(false);
const paperEditorVisible = ref(false);
const paperPreviewVisible = ref(false);
const paperEditorTab = ref('info');
const snapshotEditorVisible = ref(false);
const snapshotSaving = ref(false);
const openPaperGroups = ref([]);
const paperFilter = reactive({ keyword: '', courseId: '', status: '', sortBy: 'createdAt', sortOrder: 'desc' });
const paperPagination = reactive({ page: 1, pageSize: 20, total: 0 });
const pageSizes = [20, 50, 100];
const paperStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已发布', value: 'published' },
  { label: '已归档', value: 'archived' },
];
const form = reactive({ name: '', courseId: '', durationMinutes: 60, type: 'fixed' });
const editPaperForm = reactive({
  name: '',
  courseId: '',
  durationMinutes: 60,
  type: 'fixed',
  shuffleQuestions: false,
  shuffleOptions: false,
});
const addForm = reactive({ questionId: '', sectionTitle: '客观题', score: 2 });
const bulkForm = reactive({
  courseId: '',
  knowledgePointIds: [],
  tagIds: [],
  questionType: '',
  sectionTitle: '按标签导入',
  scoreEach: 2,
  random: false,
  count: 5,
});
const wrongFrequencyForm = reactive({
  name: '',
  courseId: '',
  questionType: '',
  sectionTitle: '高频错题',
  count: 10,
  minWrongCount: 1,
  scoreEach: 2,
});
const snapshotForm = reactive({
  paperQuestionId: '',
  title: '',
  content: '',
  analysis: '',
  options: [],
});

const canEditPaper = computed(() => detail.value?.status === 'draft');
const canEditSnapshot = computed(() => Boolean(detail.value?.canEditSnapshots));
const snapshotEditTip = computed(() => detail.value?.snapshotEditReason || '当前试卷暂不能修改显示内容');
const paperGroups = computed(() => {
  const groups = new Map();
  for (const paper of papers.value) {
    const key = paper.courseName || '未分类课程';
    groups.set(key, [...(groups.get(key) ?? []), paper]);
  }

  return [...groups.entries()].map(([name, items]) => ({
    key: name,
    name,
    items,
  }));
});
const displaySections = computed(() => {
  if (!detail.value) return [];
  const sections = (detail.value.sections ?? [])
    .filter((section) => section.questions?.length)
    .map((section) => ({
      key: section.id,
      title: section.title,
      score: section.score,
      questions: section.questions,
    }));

  if (detail.value.questions?.length) {
    sections.push({
      key: 'unsectioned',
      title: '未分区题目',
      score: detail.value.questions.reduce((sum, question) => sum + Number(question.score ?? 0), 0),
      questions: detail.value.questions,
    });
  }

  return sections;
});
const totalQuestionCount = computed(() => displaySections.value.reduce((sum, section) => sum + section.questions.length, 0));
const bulkKnowledgeTreeOptions = computed(() => convertKnowledgeTree(bulkKnowledgeTree.value));

async function loadAll() {
  const [coursePage, paperPage, questionPage, tagPage] = await Promise.all([
    api('/courses?pageSize=100'),
    api(
      `/papers${buildQuery({
        page: paperPagination.page,
        pageSize: paperPagination.pageSize,
        keyword: paperFilter.keyword,
        courseId: paperFilter.courseId,
        status: paperFilter.status,
        sortBy: paperFilter.sortBy,
        sortOrder: paperFilter.sortOrder,
      })}`,
    ),
    api('/questions?pageSize=100&status=published'),
    api('/tags?pageSize=100&type=QUESTION'),
  ]);
  courses.value = coursePage.items;
  papers.value = paperPage.items;
  paperPagination.page = paperPage.page;
  paperPagination.pageSize = paperPage.pageSize;
  paperPagination.total = paperPage.total;
  questions.value = questionPage.items;
  tags.value = tagPage.items;
  form.courseId = form.courseId || courses.value[0]?.id || '';
  wrongFrequencyForm.courseId = wrongFrequencyForm.courseId || form.courseId || '';
  bulkForm.courseId = bulkForm.courseId || form.courseId || '';
  addForm.questionId = addForm.questionId || questions.value[0]?.id || '';
  syncSelectedQuestionScore();
  selectedPaperId.value = selectedPaperId.value || papers.value[0]?.id || '';
  openPaperGroups.value = openPaperGroups.value.length ? openPaperGroups.value : paperGroups.value.slice(0, 3).map((group) => group.key);
  if (selectedPaperId.value) await loadDetail();
  await loadBulkKnowledgeTree();
}

function loadFirstPaperPage() {
  paperPagination.page = 1;
  return loadAll();
}

function handlePaperSortChange({ prop, order }) {
  paperFilter.sortBy = prop || 'createdAt';
  paperFilter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  return loadFirstPaperPage();
}

function handlePaperSizeChange(size) {
  paperPagination.pageSize = size;
  paperPagination.page = 1;
  loadAll();
}

function handlePaperCurrentChange(page) {
  paperPagination.page = page;
  loadAll();
}

async function createPaper() {
  if (!form.name.trim()) {
    ElMessage.error('请填写试卷名称');
    return;
  }
  const created = await api('/papers', { method: 'POST', body: form });
  ElMessage.success('已创建');
  form.name = '';
  createPaperVisible.value = false;
  paperFilter.sortBy = 'createdAt';
  paperFilter.sortOrder = 'desc';
  paperPagination.page = 1;
  selectedPaperId.value = created.id;
  await loadAll();
  paperPreviewVisible.value = true;
}

function openWrongFrequencyDialog() {
  wrongFrequencyForm.courseId = paperFilter.courseId || detail.value?.courseId || wrongFrequencyForm.courseId || form.courseId;
  wrongFrequencyVisible.value = true;
}

async function generateWrongFrequencyPaper() {
  if (!wrongFrequencyForm.courseId) {
    ElMessage.error('请选择课程');
    return;
  }
  const payload = {
    ...wrongFrequencyForm,
    name: wrongFrequencyForm.name.trim() || undefined,
    questionType: wrongFrequencyForm.questionType || undefined,
    sectionTitle: wrongFrequencyForm.sectionTitle.trim() || undefined,
  };
  const result = await api('/papers/generate-from-wrong-frequency', {
    method: 'POST',
    body: payload,
  });
  ElMessage.success(`已按错题频次生成 ${result.questionCount} 道题`);
  wrongFrequencyVisible.value = false;
  paperFilter.sortBy = 'createdAt';
  paperFilter.sortOrder = 'desc';
  paperPagination.page = 1;
  selectedPaperId.value = result.paperId;
  await loadAll();
  paperPreviewVisible.value = true;
}

async function selectPaper(row) {
  if (row?.id) {
    selectedPaperId.value = row.id;
    await loadDetail();
  }
}

function selectPaperById(id) {
  const paper = papers.value.find((item) => item.id === id);
  if (paper) {
    selectPaper(paper);
  }
}

async function previewPaper(row) {
  await selectPaper(row);
  if (detail.value) {
    paperPreviewVisible.value = true;
  }
}

async function openPaperEditor(row) {
  if (row?.id) {
    await selectPaper(row);
  }
  if (!detail.value) {
    ElMessage.warning('请先选择试卷');
    return;
  }
  paperEditorVisible.value = true;
}

function handlePaperCommand(row, command) {
  if (command === 'preview') return previewPaper(row);
  if (command === 'edit') return openPaperEditor(row);
  if (command === 'answer') return answerPaper(row);
  if (command === 'copy') return copyPaperAsDraft(row);
}

async function copyPaperAsDraft(row) {
  const sourceId = row?.id || selectedPaperId.value;
  if (!sourceId) {
    ElMessage.warning('请先选择试卷');
    return;
  }

  try {
    await ElMessageBox.confirm('将复制为新的草稿试卷，可继续修改题目、分值和排序，不会影响原试卷。', '复制为草稿', {
      type: 'warning',
      confirmButtonText: '复制草稿',
      cancelButtonText: '取消',
    });
    const created = await api(`/papers/${sourceId}/copy`, { method: 'POST' });
    ElMessage.success('已复制为草稿试卷');
    paperFilter.sortBy = 'createdAt';
    paperFilter.sortOrder = 'desc';
    paperPagination.page = 1;
    selectedPaperId.value = created.id;
    await loadAll();
    paperPreviewVisible.value = true;
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(error.message || '复制失败');
    }
  }
}

async function loadDetail() {
  detail.value = selectedPaperId.value ? decoratePaperDetail(await api(`/papers/${selectedPaperId.value}`)) : null;
  if (detail.value) {
    Object.assign(editPaperForm, {
      name: detail.value.name,
      courseId: detail.value.courseId,
      durationMinutes: detail.value.durationMinutes,
      type: detail.value.type,
      shuffleQuestions: detail.value.shuffleQuestions,
      shuffleOptions: detail.value.shuffleOptions,
    });
    bulkForm.courseId = detail.value.courseId || bulkForm.courseId || '';
    await loadBulkKnowledgeTree();
  }
}

async function handleBulkCourseChange() {
  bulkForm.knowledgePointIds = [];
  await loadBulkKnowledgeTree();
}

async function loadBulkKnowledgeTree() {
  bulkKnowledgeTree.value = bulkForm.courseId ? await api(`/knowledge-points/tree?courseId=${bulkForm.courseId}`) : [];
}

function syncSelectedQuestionScore() {
  const question = questions.value.find((item) => item.id === addForm.questionId);
  if (question?.defaultScore !== undefined) {
    addForm.score = Number(question.defaultScore);
  }
}

async function addQuestion() {
  if (!selectedPaperId.value || !addForm.questionId) {
    ElMessage.error('请选择试卷和题目');
    return;
  }
  await api(`/papers/${selectedPaperId.value}/questions`, { method: 'POST', body: addForm });
  ElMessage.success('已加入试卷');
  await refreshSelectedPaper();
}

async function addQuestionsByTags() {
  if (!selectedPaperId.value) {
    ElMessage.error('请选择试卷');
    return;
  }
  if (!bulkForm.courseId && !bulkForm.tagIds.length && !bulkForm.knowledgePointIds.length && !bulkForm.questionType) {
    ElMessage.error('请选择课程/大类、标签、知识点或题型中的至少一个条件');
    return;
  }

  const payload = {
    ...bulkForm,
    courseId: bulkForm.courseId || undefined,
    knowledgePointIds: bulkForm.knowledgePointIds,
    tagIds: bulkForm.tagIds,
    questionType: bulkForm.questionType || undefined,
    count: bulkForm.random ? bulkForm.count : undefined,
  };
  const result = await api(`/papers/${selectedPaperId.value}/questions/by-tags`, {
    method: 'POST',
    body: payload,
  });
  ElMessage.success(`已加入 ${result.addedCount} 道题`);
  await refreshSelectedPaper();
}

async function savePaperInfo() {
  await api(`/papers/${selectedPaperId.value}`, { method: 'PATCH', body: editPaperForm });
  ElMessage.success('试卷信息已保存');
  await refreshSelectedPaper();
}

async function unpublishPaper() {
  await api(`/papers/${selectedPaperId.value}`, { method: 'PATCH', body: { status: 'draft' } });
  ElMessage.success('已取消发布，可继续编辑');
  await refreshSelectedPaper();
}

async function updatePaperQuestion(paperQuestion) {
  await api(`/papers/${selectedPaperId.value}/questions/${paperQuestion.id}`, {
    method: 'PATCH',
    body: {
      score: paperQuestion.editScore,
      sectionTitle: paperQuestion.editSectionTitle,
    },
  });
  ElMessage.success('题目调整已保存');
  await refreshSelectedPaper();
}

function openSnapshotEditor(paperQuestion) {
  if (!canEditSnapshot.value) {
    ElMessage.warning(snapshotEditTip.value);
    return;
  }

  const currentSnapshot = snapshot(paperQuestion);
  Object.assign(snapshotForm, {
    paperQuestionId: paperQuestion.id,
    title: currentSnapshot.title || '',
    content: currentSnapshot.content || '',
    analysis: currentSnapshot.analysis || '',
    options: (currentSnapshot.options ?? []).map((option, index) => ({
      id: option.id,
      optionKey: option.optionKey || String.fromCharCode(65 + index),
      content: option.content || '',
      sortOrder: option.sortOrder ?? index + 1,
      isCorrect: Boolean(option.isCorrect),
    })),
  });
  snapshotEditorVisible.value = true;
}

async function saveSnapshotDisplay() {
  if (!snapshotForm.title.trim()) {
    ElMessage.error('题目标题不能为空');
    return;
  }
  if (!snapshotForm.content.trim()) {
    ElMessage.error('题干内容不能为空');
    return;
  }
  const emptyOptionIndex = snapshotForm.options.findIndex((option) => !option.content.trim());
  if (emptyOptionIndex >= 0) {
    ElMessage.error(`第 ${emptyOptionIndex + 1} 个选项内容不能为空`);
    return;
  }

  snapshotSaving.value = true;
  try {
    await api(`/papers/${selectedPaperId.value}/questions/${snapshotForm.paperQuestionId}/snapshot`, {
      method: 'PATCH',
      body: {
        title: snapshotForm.title,
        content: snapshotForm.content,
        analysis: snapshotForm.analysis,
        options: snapshotForm.options.length
          ? snapshotForm.options.map((option, index) => ({
              id: option.id,
              optionKey: option.optionKey || String.fromCharCode(65 + index),
              content: option.content,
              sortOrder: index + 1,
            }))
          : undefined,
      },
    });
    ElMessage.success('显示内容已保存');
    snapshotEditorVisible.value = false;
    await refreshSelectedPaper();
  } catch (error) {
    ElMessage.error(error.message || '保存显示内容失败');
  } finally {
    snapshotSaving.value = false;
  }
}

async function moveQuestion(paperQuestion, direction) {
  await api(`/papers/${selectedPaperId.value}/questions/${paperQuestion.id}/move`, {
    method: 'POST',
    body: { direction },
  });
  await refreshSelectedPaper();
}

async function removeQuestion(paperQuestion) {
  await ElMessageBox.confirm(`确认从试卷中删除“${snapshot(paperQuestion).title}”？`, '删除题目', { type: 'warning' });
  await api(`/papers/${selectedPaperId.value}/questions/${paperQuestion.id}`, { method: 'DELETE' });
  ElMessage.success('已删除题目');
  await refreshSelectedPaper();
}

async function publishPaper() {
  await api(`/papers/${selectedPaperId.value}/publish`, { method: 'POST' });
  ElMessage.success('已发布');
  await refreshSelectedPaper();
}

function answerPaper(row) {
  const paperId = row?.id || selectedPaperId.value;
  if (!paperId) return;
  router.push(`/papers/${paperId}/answer`);
}

async function refreshSelectedPaper() {
  const currentId = selectedPaperId.value;
  await loadAll();
  selectedPaperId.value = currentId;
  await loadDetail();
}

function snapshot(paperQuestion) {
  return paperQuestion.questionSnapshotJson ?? {};
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function decoratePaperDetail(paper) {
  const decorateQuestion = (question, sectionTitle) => ({
    ...question,
    editScore: Number(question.score),
    editSectionTitle: sectionTitle,
  });

  return {
    ...paper,
    sections: (paper.sections ?? []).map((section) => ({
      ...section,
      questions: (section.questions ?? []).map((question) => decorateQuestion(question, section.title)),
    })),
    questions: (paper.questions ?? []).map((question) => decorateQuestion(question, '')),
  };
}

function convertKnowledgeTree(items) {
  return items.map((item) => ({
    label: `${item.sortOrder ? `${item.sortOrder}. ` : ''}${item.name}`,
    value: item.id,
    children: convertKnowledgeTree(item.children ?? []),
  }));
}

onMounted(loadAll);
</script>
