<template>
<section class="panel import-preview">
    <template v-if="importMode === 'single'">
      <div class="paper-preview-head">
        <div>
          <h2>单题预览</h2>
          <span class="muted">{{ typeLabel(singlePreviewQuestion.type) }} · {{ singlePreviewQuestion.defaultScore }} 分</span>
        </div>
        <div class="toolbar">
          <el-tag :type="singlePreviewError ? 'danger' : 'success'">
            {{ singlePreviewError ? '需修正' : '可导入' }}
          </el-tag>
          <el-tag v-if="singleConflictStatus && singleConflictStatus !== 'ok'" :type="conflictTagType(singleConflictStatus)" effect="plain">
            {{ conflictLabel(singleConflictStatus) }}
          </el-tag>
          <el-tag type="info">实时预览</el-tag>
        </div>
      </div>

      <el-alert
        v-if="singlePreviewError"
        :title="singlePreviewError"
        type="warning"
        show-icon
        :closable="false"
        class="batch-alert"
      />
      <el-alert
        v-else-if="singleConflictMessage"
        :title="singleConflictMessage"
        :type="singleConflictStatus === 'conflict' ? 'error' : 'warning'"
        show-icon
        :closable="false"
        class="batch-alert"
      />

      <div class="question-import-detail">
        <div class="paper-question-meta">
          <el-tag>{{ typeLabel(singlePreviewQuestion.type) }}</el-tag>
          <el-tag type="info">{{ singlePreviewQuestion.defaultScore }} 分</el-tag>
          <el-tag v-for="name in singlePreviewQuestion.knowledgePointNames || []" :key="name" type="success" effect="plain">
            {{ name }}
          </el-tag>
          <el-tag v-for="tag in singlePreviewQuestion.tagNames || []" :key="tag" effect="plain">{{ tag }}</el-tag>
        </div>
        <h3>{{ singlePreviewQuestion.title || '未命名题目' }}</h3>
        <MarkdownRenderer :source="singlePreviewQuestion.content || ''" />
        <div v-if="singlePreviewQuestion.type === 'material' && singlePreviewQuestion.inlineChildren?.length" class="material-preview-children">
          <section v-for="(child, index) in singlePreviewQuestion.inlineChildren" :key="`${child.type}-${index}`" class="material-preview-child">
            <div class="paper-question-meta">
              <el-tag>子题 {{ Number(index) + 1 }}</el-tag>
              <el-tag>{{ typeLabel(child.type ?? '') }}</el-tag>
              <el-tag type="info">{{ child.score }} 分</el-tag>
            </div>
            <h4>{{ child.title || `子题 ${Number(index) + 1}` }}</h4>
            <MarkdownRenderer :source="child.content || ''" />
            <div v-if="child.options?.length" class="paper-option-list">
              <div
                v-for="option in child.options"
                :key="option.optionKey"
                :class="['paper-option', option.isCorrect ? 'correct' : '']"
              >
                <strong>{{ option.optionKey }}.</strong>
                <MarkdownRenderer :source="option.content" />
                <span v-if="option.isCorrect" class="answer-mark success">正确答案</span>
              </div>
            </div>
          </section>
        </div>
        <div v-if="singlePreviewQuestion.options?.length" class="paper-option-list">
          <div
            v-for="option in singlePreviewQuestion.options"
            :key="option.optionKey"
            :class="['paper-option', option.isCorrect ? 'correct' : '']"
          >
            <strong>{{ option.optionKey }}.</strong>
            <MarkdownRenderer :source="option.content" />
            <span v-if="option.isCorrect" class="answer-mark success">正确答案</span>
          </div>
        </div>
        <div v-if="singlePreviewQuestion.analysis" class="paper-analysis">
          <strong>解析</strong>
          <MarkdownRenderer :source="singlePreviewQuestion.analysis" />
        </div>
      </div>
    </template>

    <template v-else>
      <div class="paper-preview-head">
        <div>
          <h2>解析结果</h2>
          <span class="muted">{{ importableBatchCount }} / {{ batchPreview.length }} 道可导入</span>
        </div>
        <div class="toolbar">
          <el-tag :type="batchErrorSummary ? 'danger' : 'success'">{{ batchErrorSummary ? '需修正' : '格式可用' }}</el-tag>
          <el-tag type="info">实时预览</el-tag>
        </div>
      </div>

      <el-table
        v-if="batchPreview.length"
        :data="batchPreview"
        height="280"
        highlight-current-row
        :row-class-name="batchRowClass"
        @current-change="selectPreview"
      >
        <el-table-column label="#" width="56">
          <template #default="{ row }">{{ row.number }}</template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="220" />
        <el-table-column label="题型" width="110">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column label="标签" min-width="180">
          <template #default="{ row }">
            <el-tag v-for="tag in row.tagNames || []" :key="tag" size="small" effect="plain">{{ tag }}</el-tag>
            <span v-if="!(row.tagNames || []).length" class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column label="知识点" min-width="180">
          <template #default="{ row }">
            <el-tag v-for="name in row.knowledgePointNames || []" :key="name" size="small" type="success" effect="plain">
              {{ name }}
            </el-tag>
            <span v-if="!(row.knowledgePointNames || []).length" class="muted">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="answerText" label="答案" width="120" />
        <el-table-column label="状态" min-width="180">
          <template #default="{ row }">
            <el-tag :type="row.valid === false ? 'danger' : row.statusText?.includes('已导入') ? 'success' : 'info'">
              {{ row.statusText }}
            </el-tag>
            <el-tag v-if="row.conflictStatus && row.conflictStatus !== 'ok'" :type="conflictTagType(row.conflictStatus)" effect="plain">
              {{ conflictLabel(row.conflictStatus) }}
            </el-tag>
            <div v-if="row.conflictMessage" class="mini-muted">{{ row.conflictMessage }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="92" fixed="right">
          <template #default="{ row }">
            <el-button size="small" plain :icon="Delete" @click.stop="removeBatchPreviewRow(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="粘贴题目内容后自动解析" />

      <div v-if="selectedBatchQuestion" class="question-import-detail">
        <div class="paper-question-meta">
          <el-tag>{{ typeLabel(selectedBatchQuestion.type) }}</el-tag>
          <el-tag type="info">{{ selectedBatchQuestion.defaultScore }} 分</el-tag>
          <el-tag v-for="name in selectedBatchQuestion.knowledgePointNames || []" :key="name" type="success" effect="plain">
            {{ name }}
          </el-tag>
          <el-tag v-for="tag in selectedBatchQuestion.tagNames || []" :key="tag" effect="plain">{{ tag }}</el-tag>
          <span
            v-if="!(selectedBatchQuestion.knowledgePointNames || []).length && !(selectedBatchQuestion.tagNames || []).length"
            class="muted"
          >
            无知识点/标签
          </span>
        </div>
        <h3>{{ selectedBatchQuestion.number }}. {{ selectedBatchQuestion.title }}</h3>
        <MarkdownRenderer :source="selectedBatchQuestion.content || ''" />
        <div v-if="selectedBatchQuestion.options?.length" class="paper-option-list">
          <div
            v-for="option in selectedBatchQuestion.options"
            :key="option.optionKey"
            :class="['paper-option', option.isCorrect ? 'correct' : '']"
          >
            <strong>{{ option.optionKey }}.</strong>
            <MarkdownRenderer :source="option.content" />
            <span v-if="option.isCorrect" class="answer-mark success">正确答案</span>
          </div>
        </div>
        <div v-if="selectedBatchQuestion.analysis" class="paper-analysis">
          <strong>解析</strong>
          <MarkdownRenderer :source="selectedBatchQuestion.analysis" />
        </div>
      </div>
    </template>
  </section>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionImportPageContext } from '../composables/questionImportPageContext';
import MarkdownRenderer from '../../../components/MarkdownRenderer.vue';

export default defineComponent({
  components: { MarkdownRenderer },
  setup: useQuestionImportPageContext,
});
</script>
