<template>
  <div class="page import-page">
    <div class="page-head">
      <h1 class="page-title">题目导入</h1>
      <div class="toolbar">
        <el-button :icon="Back" @click="router.push('/questions')">返回题库</el-button>
        <el-upload
          :key="portableUploadKey"
          ref="portableUploadRef"
          accept=".zip,.json,.csv,.md,.txt"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="handlePortableImportChange"
        >
          <el-button :icon="Upload">导入题目文件</el-button>
        </el-upload>
        <el-button :icon="Refresh" @click="loadBaseData">刷新基础数据</el-button>
      </div>
    </div>

    <section class="panel import-shared-panel">
      <el-form label-width="72px" class="import-shared-form">
        <el-form-item label="课程">
          <el-select v-model="sharedCourseId" filterable clearable style="width: 100%" @change="handleSharedCourseChange">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="知识点">
          <el-tree-select
            v-model="sharedKnowledgePointIds"
            :data="knowledgeTreeOptions"
            multiple
            check-strictly
            collapse-tags
            collapse-tags-tooltip
            clearable
            filterable
            placeholder="可选择所属知识点"
            style="width: 100%"
            @change="refreshPreview"
          />
        </el-form-item>
        <el-form-item :label="importMode === 'batch' ? '批次标签' : '标签'">
          <el-select
            v-model="sharedTagNames"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="输入或选择标签"
            style="width: 100%"
            @change="refreshPreview"
          >
            <el-option v-for="tag in tags" :key="tag.id" :label="tag.name" :value="tag.name" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="importMode === 'batch' || singleForm.type === 'fill_blank' || hasMaterialFillBlankChild" label="填空规则" class="compact-form-item">
          <div class="inline-control">
            <el-checkbox v-model="blankCaseSensitive">区分大小写</el-checkbox>
            <el-checkbox v-model="blankSpaceSensitive">区分首尾空格</el-checkbox>
          </div>
        </el-form-item>
        <el-form-item label="发布" class="compact-form-item">
          <el-checkbox v-model="publishAfterImport">导入后立即发布</el-checkbox>
        </el-form-item>
        <el-form-item label="附件" class="compact-form-item">
          <div class="asset-toolbar">
            <el-upload
              :key="assetUploadKey"
              ref="assetUploadRef"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.zip"
              multiple
              :auto-upload="false"
              :show-file-list="false"
              :on-change="handleAssetUploadChange"
            >
              <el-button :icon="Upload" :loading="uploadingAsset">上传附件</el-button>
            </el-upload>
            <el-button :type="uploadedAssets.length ? 'primary' : 'default'" plain @click="assetDrawerVisible = true">
              附件区（{{ uploadedAssets.length }}）
            </el-button>
          </div>
        </el-form-item>
      </el-form>
    </section>

    <div class="import-layout">
      <section class="panel import-editor">
        <QuestionImportEditorTabs />
      </section>

      <QuestionImportPreview />
    </div>

    <MaterialChildEditorDialog />

    <QuestionAssetDrawer />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useQuestionImportPage } from '../composables/useQuestionImportPage';
import { provideQuestionImportPageContext } from '../composables/questionImportPageContext';
import QuestionImportEditorTabs from './QuestionImportEditorTabs.vue';
import QuestionImportPreview from './QuestionImportPreview.vue';
import MaterialChildEditorDialog from './MaterialChildEditorDialog.vue';
import QuestionAssetDrawer from './QuestionAssetDrawer.vue';

export default defineComponent({
  name: 'QuestionImportPage',
  components: { QuestionImportEditorTabs, QuestionImportPreview, MaterialChildEditorDialog, QuestionAssetDrawer },
  setup() {
    const context = useQuestionImportPage();
    provideQuestionImportPageContext(context);
    return context;
  },
});
</script>

<style>
.mini-muted {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

:deep(.batch-row-error) {
  --el-table-tr-bg-color: #fff2f0;
}

:deep(.batch-row-skip) {
  --el-table-tr-bg-color: #fff8e6;
}

.material-preview-child {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-bg-color);
}

.material-child-choice-editor {
  padding: 10px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.compact-toolbar {
  margin-bottom: 8px;
}

.material-preview-children {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.material-preview-child h4 {
  margin: 0;
  font-size: 15px;
}

.material-child-editor {
  display: grid;
  width: 100%;
  gap: 10px;
}

.question-entry-guide {
  margin-bottom: 12px;
}

.material-child-editor-head {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
}

.material-child-editor-head p {
  margin: 4px 0 0;
}

.material-child-builder {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}

.material-child-list {
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 180px;
  padding: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}

.material-child-list-item {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: 9px 10px;
  color: var(--el-text-color-primary);
  text-align: left;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--el-bg-color);
}

.material-child-list-item.active,
.material-child-list-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-color-primary-light-9);
}

.material-child-list-item strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-child-list-item small,
.material-child-index {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.material-child-actions {
  display: grid;
  align-content: start;
  gap: 10px;
}

.selected-material-child-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  align-items: center;
  padding: 10px 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-light);
}

.selected-material-child-summary .mini-muted,
.selected-material-child-summary > span:last-of-type {
  grid-column: 1;
}

.material-child-dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.subjective-answer-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.subjective-answer-editor {
  display: grid;
  width: 100%;
  gap: 10px;
}

@media (max-width: 900px) {
  .material-child-builder,
  .material-child-dialog-grid {
    grid-template-columns: 1fr;
  }
}
</style>
