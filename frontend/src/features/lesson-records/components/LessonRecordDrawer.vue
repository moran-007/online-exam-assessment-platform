<template>
  <el-drawer :model-value="modelValue" size="min(980px, 96vw)" destroy-on-close @update:model-value="$emit('update:modelValue', $event)">
    <template #header>
      <div>
        <strong>教学记录 · {{ detail?.session?.title || '加载中' }}</strong>
        <div class="muted">{{ detail?.session?.classGroup?.name }} · {{ formatTime(detail?.session?.startsAt) }}</div>
      </div>
    </template>

    <div v-loading="loading" class="lesson-record-editor" data-testid="lesson-record-editor">
      <el-alert
        title="教师内部字段不会返回给学生或家长；任何编辑和附件变化都会让已发布记录退回草稿。"
        type="info"
        :closable="false"
        show-icon
      />

      <div class="record-toolbar">
        <div>
          <el-tag :type="statusType(detail?.record?.status)">{{ statusText(detail?.record?.status) }}</el-tag>
          <span v-if="detail?.record" class="muted">版本 v{{ detail.record.version }}</span>
        </div>
        <div>
          <el-button type="primary" plain @click="openLessonAssistant">AI 课堂助手</el-button>
          <el-button data-testid="save-lesson-record" :loading="saving" @click="save">保存草稿</el-button>
          <el-button v-if="detail?.record?.status === 'DRAFT'" data-testid="submit-lesson-record" type="warning" @click="submit">提交</el-button>
          <el-button v-if="detail?.record?.status === 'SUBMITTED'" data-testid="publish-lesson-record" type="success" @click="publish">发布</el-button>
        </div>
      </div>

      <el-tabs>
        <el-tab-pane label="学生/家长可见">
          <div class="record-form-grid">
            <el-form-item label="本节课内容" class="wide"><el-input v-model="form.publicTeachingContent" type="textarea" :rows="5" /></el-form-item>
            <el-form-item label="学习目标"><el-input v-model="form.publicLearningGoal" type="textarea" :rows="4" /></el-form-item>
            <el-form-item label="课堂表现"><el-input v-model="form.publicClassPerformance" type="textarea" :rows="4" /></el-form-item>
            <el-form-item label="课后作业"><el-input v-model="form.publicHomework" type="textarea" :rows="4" /></el-form-item>
            <el-form-item label="下次计划"><el-input v-model="form.publicNextPlan" type="textarea" :rows="4" /></el-form-item>
            <el-form-item label="学习材料说明" class="wide"><el-input v-model="form.publicMaterials" type="textarea" :rows="3" /></el-form-item>
          </div>
        </el-tab-pane>
        <el-tab-pane label="教师内部">
          <div class="record-form-grid">
            <el-form-item label="教学备忘"><el-input v-model="form.internalTeachingNotes" type="textarea" :rows="8" /></el-form-item>
            <el-form-item label="内部学情观察"><el-input v-model="form.internalClassPerformance" type="textarea" :rows="8" /></el-form-item>
          </div>
        </el-tab-pane>
        <el-tab-pane label="课次附件">
          <div class="asset-upload">
            <el-upload :auto-upload="false" :show-file-list="false" :limit="1" :on-change="selectFile">
              <el-button>选择附件</el-button>
            </el-upload>
            <span class="muted">{{ uploadFile?.name || '支持图片、PDF、Office、ZIP、文本和 Scratch .sb3，单个不超过 50MB' }}</span>
            <el-select v-model="uploadForm.audience" style="width: 170px">
              <el-option label="学生/家长可见" value="LEARNER" />
              <el-option label="仅教师内部" value="INTERNAL" />
            </el-select>
            <el-input v-model="uploadForm.title" placeholder="附件标题（可选）" />
            <el-button data-testid="upload-lesson-asset" type="primary" @click="upload">上传</el-button>
          </div>
          <el-table :data="detail?.record?.assets || []" data-testid="lesson-asset-table">
            <el-table-column label="附件" min-width="260"><template #default="{ row }"><strong>{{ row.title || row.fileName }}</strong><div class="muted">{{ row.fileName }} · {{ fileSize(row.fileSize) }}</div></template></el-table-column>
            <el-table-column label="可见范围" width="140"><template #default="{ row }"><el-tag :type="row.audience === 'LEARNER' ? 'success' : 'info'">{{ row.audience === 'LEARNER' ? '学生/家长' : '教师内部' }}</el-tag></template></el-table-column>
            <el-table-column label="完整性" min-width="190"><template #default="{ row }"><span class="hash">{{ row.sha256 || '-' }}</span></template></el-table-column>
            <el-table-column label="操作" width="190" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="previewAsset(row)">预览</el-button><el-button link type="primary" @click="downloadAsset(row)">下载</el-button><el-button link type="danger" @click="removeAssetRow(row)">移除</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane label="版本历史">
          <el-table :data="versions" data-testid="lesson-record-versions">
            <el-table-column prop="version" label="版本" width="90" />
            <el-table-column label="动作" width="130"><template #default="{ row }">{{ actionText(row.action) }}</template></el-table-column>
            <el-table-column label="状态" width="120"><template #default="{ row }">{{ statusText(row.status) }}</template></el-table-column>
            <el-table-column prop="reason" label="说明" min-width="220" />
            <el-table-column label="时间" width="190"><template #default="{ row }">{{ formatTime(row.createdAt) }}</template></el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-drawer>
  <AiSummaryDialog ref="lessonAssistantDialog" kind="lesson" @apply-lesson="applyAiDraft" />
</template>

<script setup lang="ts">
import { ref, toRef, watch } from 'vue';
import { useLessonRecordEditor } from '../composables/useLessonRecordEditor';
import type { LessonAssetView } from '../api';
import AiSummaryDialog from '../../ai/components/AiSummaryDialog.vue';

const props = defineProps<{ modelValue: boolean; sessionId: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>();
const sessionId = toRef(props, 'sessionId');
const lessonAssistantDialog = ref<InstanceType<typeof AiSummaryDialog>>();
const {
  applyAiDraft, detail, form, load, loading, openLessonAsset, publish, removeAsset, save, saving,
  selectFile, submit, upload, uploadFile, uploadForm, versions,
} = useLessonRecordEditor(sessionId, () => emit('changed'));

function openLessonAssistant() {
  const name = detail.value?.session?.title || '当前课次';
  void lessonAssistantDialog.value?.open(sessionId.value, name);
}

watch(() => [props.modelValue, props.sessionId], ([visible, id]) => {
  if (visible && id) void load();
}, { immediate: true });

const statusText = (value?: string) => ({ DRAFT: '草稿', SUBMITTED: '待发布', PUBLISHED: '已发布' }[value || ''] || '尚未创建');
const statusType = (value?: string): 'info' | 'warning' | 'success' => ({ SUBMITTED: 'warning', PUBLISHED: 'success' }[value || ''] || 'info') as 'info' | 'warning' | 'success';
const actionText = (value: string) => ({ SAVE_DRAFT: '保存草稿', SUBMIT: '提交', PUBLISH: '发布', ASSET_ADD: '添加附件', ASSET_REMOVE: '移除附件', IMPORT: '历史迁移' }[value] || value);
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const fileSize = (value: string) => `${Math.max(0, Number(value) / 1024).toFixed(1)} KB`;
const previewAsset = (row: unknown) => openLessonAsset(sessionId.value, row as LessonAssetView);
const downloadAsset = (row: unknown) => openLessonAsset(sessionId.value, row as LessonAssetView, { download: true });
const removeAssetRow = (row: unknown) => removeAsset(row as LessonAssetView);
</script>

<style scoped>
.lesson-record-editor { min-height: 420px; }
.record-toolbar, .asset-upload { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 16px 0; }
.record-toolbar > div { display: flex; align-items: center; gap: 10px; }
.record-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.record-form-grid .wide { grid-column: 1 / -1; }
.record-form-grid :deep(.el-form-item) { display: block; }
.asset-upload { justify-content: flex-start; flex-wrap: wrap; }
.asset-upload .el-input { width: min(320px, 100%); }
.hash { display: inline-block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, monospace; }
@media (max-width: 760px) { .record-form-grid { grid-template-columns: 1fr; } .record-form-grid .wide { grid-column: auto; } }
</style>
