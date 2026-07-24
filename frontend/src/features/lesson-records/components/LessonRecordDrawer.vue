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
        <el-tab-pane label="教案与课后生成">
          <div class="lesson-plan-link">
            <el-form-item label="关联预设教案">
              <el-select v-model="selectedPlanId" filterable clearable style="width:100%" placeholder="选择与本课程/知识点匹配的教案">
                <el-option
                  v-for="plan in matchingPlans"
                  :key="plan.id"
                  :label="planOptionLabel(plan)"
                  :value="plan.id"
                />
              </el-select>
            </el-form-item>
            <el-alert
              v-if="!matchingPlans.length"
              title="当前课程暂无预设教案，可先前往“课程、知识点与教案 → 教案”新增。"
              type="warning"
              :closable="false"
            />
            <el-collapse v-if="selectedPlan" v-model="linkedPlanSections" class="linked-plan-collapse">
              <el-collapse-item name="selected-plan">
                <template #title>
                  <div class="linked-plan-title">
                    <strong>{{ selectedPlan.theme }}</strong>
                    <el-tag :type="selectedPlan.source === 'PERSONAL' ? 'success' : 'info'" size="small">{{ selectedPlan.source === 'PERSONAL' ? '个人教案' : '系统教案' }}</el-tag>
                    <span class="muted">作者：{{ selectedPlan.authorName }}</span>
                    <el-tag v-if="selectedPlan.id === recommendedPlanId" type="warning" size="small">优先使用</el-tag>
                  </div>
                </template>
                <el-descriptions :column="2" border>
                  <el-descriptions-item label="课题">{{ selectedPlan.theme }}</el-descriptions-item>
                  <el-descriptions-item label="对象/课时">{{ selectedPlan.gradeLevel || '未填写' }} · {{ selectedPlan.durationMinutes }} 分钟</el-descriptions-item>
                  <el-descriptions-item label="上传者/作者">{{ selectedPlan.authorName }}</el-descriptions-item>
                  <el-descriptions-item label="教案来源">{{ selectedPlan.source === 'PERSONAL' ? '教师个人教案' : '系统通用教案' }}</el-descriptions-item>
                  <el-descriptions-item label="教学重点">{{ selectedPlan.keyPoints || '未填写' }}</el-descriptions-item>
                  <el-descriptions-item label="教学难点">{{ selectedPlan.difficultPoints || '未填写' }}</el-descriptions-item>
                  <el-descriptions-item label="教学过程" :span="2">{{ planProcessSummary(selectedPlan) }}</el-descriptions-item>
                </el-descriptions>
                <el-button class="prefill-button" plain type="primary" @click="prefillFromPlan">按教案预填公开草稿</el-button>
              </el-collapse-item>
            </el-collapse>
          </div>
          <el-divider content-position="left">结合实际上课生成家长/学生可见内容</el-divider>
          <el-alert title="先记录实际授课调整和真实课堂表现，再由 AI 结合预设教案生成公开草稿；生成结果仍可在“学生/家长可见”中逐项修改。" type="info" :closable="false" />
          <div class="record-form-grid actual-record-fields">
            <el-form-item label="实际上课记录/临场调整"><el-input v-model="form.internalTeachingNotes" type="textarea" :rows="7" placeholder="例如：实际完成到哪个环节、临时增加或删减内容、学生常见问题" /></el-form-item>
            <el-form-item label="真实课堂表现观察"><el-input v-model="form.internalClassPerformance" type="textarea" :rows="7" placeholder="例如：参与度、掌握情况、个别困难；仅教师内部可见" /></el-form-item>
          </div>
          <div class="post-class-ai">
            <el-select v-model="recordAiConfigId" clearable placeholder="自动选择 AI 模型" style="width:260px">
              <el-option v-for="item in aiConfigurations" :key="item.id" :label="`${item.name} · ${item.model}`" :value="item.id" />
            </el-select>
            <el-button type="primary" :loading="generatingPublicRecord" :disabled="!selectedPlan" @click="generatePublicRecord">
              AI 结合教案与实际上课填入公开字段
            </el-button>
          </div>
        </el-tab-pane>
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
            <el-upload ref="assetUpload" :auto-upload="false" :show-file-list="false" :limit="1" :on-change="selectFile">
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
        <el-tab-pane label="Scratch 课堂" lazy>
          <ScratchClassroomPanel :session-id="sessionId" />
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-drawer>
  <AiSummaryDialog ref="lessonAssistantDialog" kind="lesson" @apply-lesson="applyAiDraft" />
</template>

<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { ElMessage, type UploadInstance } from 'element-plus';
import { getCurrentUser } from '../../../api';
import { useLessonRecordEditor } from '../composables/useLessonRecordEditor';
import type { LessonAssetView } from '../api';
import AiSummaryDialog from '../../ai/components/AiSummaryDialog.vue';
import ScratchClassroomPanel from '../../scratch/components/ScratchClassroomPanel.vue';
import { generateAiSummary, listAiConfigurations } from '../../ai/api';
import type { AiProviderConfig } from '../../ai/models';
import { isLessonPlanReady, useLessonPlanCatalog } from '../composables/useLessonPlanCatalog';
import { buildLessonRecordAiPromptContent } from '../composables/lessonRecordAiPrompt';
import { parseStructuredAiOutput, pickStructuredText } from '../composables/structuredAiOutput';

const props = defineProps<{ modelValue: boolean; sessionId: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; changed: [] }>();
const sessionId = toRef(props, 'sessionId');
const lessonAssistantDialog = ref<InstanceType<typeof AiSummaryDialog>>();
const assetUpload = ref<UploadInstance>();
const selectedPlanId = ref('');
const linkedPlanSections = ref(['selected-plan']);
const recordAiConfigId = ref('');
const aiConfigurations = ref<AiProviderConfig[]>([]);
const generatingPublicRecord = ref(false);
const currentUser = getCurrentUser() as { id?: string; username?: string } | null;
const currentAuthorId = String(currentUser?.id || currentUser?.username || '');
const { plans, load: loadLessonPlans } = useLessonPlanCatalog();
const {
  applyAiDraft, applyLessonPlanDraft, applyPublicAiDraft, detail, form, load, loading,
  openLessonAsset, publish, removeAsset, save, saving, selectFile, submit,
  upload: uploadAsset, uploadFile, uploadForm, versions,
} = useLessonRecordEditor(sessionId, () => emit('changed'));
const matchingPlans = computed(() => {
  const courseId = detail.value?.session?.classGroup?.course?.id;
  const knowledgePointId = detail.value?.session?.knowledgePoint?.id;
  return plans.value
    .filter((plan) => (!courseId || plan.courseId === courseId)
      && (!knowledgePointId || !plan.knowledgePointId || plan.knowledgePointId === knowledgePointId)
      && (plan.source === 'SYSTEM' || (plan.source === 'PERSONAL' && plan.authorId === currentAuthorId)))
    .sort((left, right) => {
      const readinessOrder = Number(isLessonPlanReady(right)) - Number(isLessonPlanReady(left));
      if (readinessOrder) return readinessOrder;
      const sourceOrder = Number(left.source === 'SYSTEM') - Number(right.source === 'SYSTEM');
      if (sourceOrder) return sourceOrder;
      const knowledgeOrder = Number(right.knowledgePointId === knowledgePointId) - Number(left.knowledgePointId === knowledgePointId);
      if (knowledgeOrder) return knowledgeOrder;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
});
const selectedPlan = computed(() => plans.value.find((plan) => plan.id === selectedPlanId.value) || null);
const recommendedPlanId = computed(() => matchingPlans.value[0]?.id || '');

async function upload() {
  await uploadAsset();
  if (!uploadFile.value) assetUpload.value?.clearFiles();
}

function openLessonAssistant() {
  const name = detail.value?.session?.title || '当前课次';
  void lessonAssistantDialog.value?.open(sessionId.value, name);
}

watch(() => [props.modelValue, props.sessionId], async ([visible, id]) => {
  if (!visible || !id) return;
  await Promise.all([load(), loadLessonPlans(true), loadRecordAiConfigurations()]);
  selectedPlanId.value = recommendedPlanId.value;
  linkedPlanSections.value = selectedPlanId.value ? ['selected-plan'] : [];
}, { immediate: true });

watch(selectedPlanId, (id) => {
  linkedPlanSections.value = id ? ['selected-plan'] : [];
});

async function loadRecordAiConfigurations() {
  if (!aiConfigurations.value.length) aiConfigurations.value = (await listAiConfigurations()).filter((item) => item.enabled);
  recordAiConfigId.value ||= aiConfigurations.value.find((item) => item.isDefault)?.id || aiConfigurations.value[0]?.id || '';
}

async function prefillFromPlan() {
  const plan = selectedPlan.value;
  if (!plan) return;
  const replacement = {
    publicTeachingContent: [
      plan.teachingContent,
      ...plan.teachingProcess.map((stage) => [
        `${stage.title}（${stage.duration}分钟）`,
        stage.coreQuestion && `核心问题：${stage.coreQuestion}`,
        stage.studentActivity && `学习活动：${stage.studentActivity}`,
      ].filter(Boolean).join('\n')),
    ].filter(Boolean).join('\n\n'),
    publicLearningGoal: [
      plan.knowledgeObjectives,
      plan.processObjectives,
      plan.valueObjectives,
      plan.coreCompetencies,
    ].filter(Boolean).join('\n'),
    publicHomework: plan.homework,
    publicMaterials: [
      plan.teachingMeans,
      plan.preparation,
      ...plan.teachingProcess.map((stage) => stage.resources),
    ].filter(Boolean).join('\n'),
  };
  await applyLessonPlanDraft(replacement);
}

async function generatePublicRecord() {
  const plan = selectedPlan.value;
  if (!plan) return ElMessage.warning('请先选择预设教案');
  if (!form.internalTeachingNotes.trim() && !form.internalClassPerformance.trim()) {
    return ElMessage.warning('请先填写实际上课记录或真实课堂表现');
  }
  generatingPublicRecord.value = true;
  try {
    await loadRecordAiConfigurations();
    const result = await generateAiSummary({
      configId: recordAiConfigId.value || undefined,
      content: buildLessonRecordAiPromptContent({
        plan,
        sessionTitle: detail.value?.session?.title || plan.theme,
        actualTeachingNotes: form.internalTeachingNotes,
        classPerformance: form.internalClassPerformance,
      }),
      instruction: '你是课后教学记录助手。只返回合法 JSON，JSON 外不要解释或代码围栏。字段必须为 publicTeachingContent,publicLearningGoal,publicClassPerformance,publicHomework,publicNextPlan,publicMaterials，值均为字符串；每个分点独占一行并用 \\n 分隔。字段内容可在确有需要时保留 Markdown、LaTeX 公式、化学式或代码块。必须以预设教案和教师提供的实际上课记录为依据；公开措辞客观、适合家长学生阅读，不泄露教师内部备注，不编造未提供的课堂事实。',
    });
    await applyPublicAiDraft(pickStructuredText(parseStructuredAiOutput(result.summary), [
      'publicTeachingContent', 'publicLearningGoal', 'publicClassPerformance',
      'publicHomework', 'publicNextPlan', 'publicMaterials',
    ]));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '课后公开记录生成失败');
  } finally {
    generatingPublicRecord.value = false;
  }
}

const statusText = (value?: string) => ({ DRAFT: '草稿', SUBMITTED: '待发布', PUBLISHED: '已发布' }[value || ''] || '尚未创建');
const statusType = (value?: string): 'info' | 'warning' | 'success' => ({ SUBMITTED: 'warning', PUBLISHED: 'success' }[value || ''] || 'info') as 'info' | 'warning' | 'success';
const actionText = (value: string) => ({ SAVE_DRAFT: '保存草稿', SUBMIT: '提交', PUBLISH: '发布', ASSET_ADD: '添加附件', ASSET_REMOVE: '移除附件', IMPORT: '历史迁移' }[value] || value);
const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
const planProcessSummary = (plan: NonNullable<typeof selectedPlan.value>) => plan.teachingProcess
  .map((stage) => `${stage.title}（${stage.duration}分钟）`)
  .join(' → ') || '未设置';
const planOptionLabel = (plan: NonNullable<typeof selectedPlan.value>) => [
  `【${plan.source === 'PERSONAL' ? '个人' : '系统'}】${plan.theme}`,
  `作者：${plan.authorName}`,
  plan.id === recommendedPlanId.value ? '优先使用' : '',
].filter(Boolean).join(' · ');
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
.lesson-plan-link { display: grid; gap: 14px; margin-bottom: 18px; }
.lesson-plan-link > .el-button { justify-self: start; }
.linked-plan-collapse { border: 1px solid var(--el-border-color); border-radius: 10px; overflow: hidden; }
.linked-plan-collapse :deep(.el-collapse-item__header) { min-height: 52px; padding: 0 14px; background: var(--el-fill-color-light); }
.linked-plan-collapse :deep(.el-collapse-item__content) { padding: 14px; }
.linked-plan-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.prefill-button { margin-top: 12px; }
.actual-record-fields { margin-top: 16px; }
.post-class-ai { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin: 4px 0 16px; }
.asset-upload { justify-content: flex-start; flex-wrap: wrap; }
.asset-upload .el-input { width: min(320px, 100%); }
.hash { display: inline-block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, monospace; }
@media (max-width: 760px) { .record-form-grid { grid-template-columns: 1fr; } .record-form-grid .wide { grid-column: auto; } }
</style>
