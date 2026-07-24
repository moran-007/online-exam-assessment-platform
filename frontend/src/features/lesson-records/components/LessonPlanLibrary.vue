<template>
  <div class="lesson-plan-library">
    <section class="page-head">
      <div>
        <h1 class="page-title">教案库</h1>
        <p class="muted">系统通用教案与教师个人教案统一管理；同一课程、知识点可保存多份教案。</p>
      </div>
      <el-button v-if="canManageLessonPlans" type="primary" @click="() => openCreate()">录入个人教案</el-button>
    </section>

    <section class="panel lesson-plan-panel">
      <div class="lesson-plan-filter">
        <el-select v-model="courseFilter" clearable placeholder="全部课程" style="width:220px">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-select v-model="sourceFilter" clearable placeholder="全部来源" style="width:150px">
          <el-option label="系统教案" value="SYSTEM" />
          <el-option label="个人教案" value="PERSONAL" />
        </el-select>
        <el-input v-model="keyword" clearable placeholder="搜索课题、目标或教学环节" style="width:280px" />
        <span class="muted">共 {{ filteredPlans.length }} 份教案</span>
      </div>
      <el-empty v-if="!filteredPlans.length" description="暂无教案" />
      <el-table v-else :data="filteredPlans" row-key="id" height="calc(100% - 52px)">
        <el-table-column type="expand" width="46">
          <template #default="{ row }">
            <div class="inline-plan-preview">
              <LessonPlanDocument :plan="planRow(row)" :context="inlinePreviewContext(planRow(row))" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="105">
          <template #default="{ row }"><el-tag :type="row.source === 'PERSONAL' ? 'success' : 'info'">{{ sourceLabel(row.source) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="课程" width="150"><template #default="{ row }">{{ courseName(row.courseId) }}</template></el-table-column>
        <el-table-column prop="theme" label="课题" min-width="210" />
        <el-table-column label="上传者/作者" width="150"><template #default="{ row }">{{ row.authorName }}</template></el-table-column>
        <el-table-column label="教学过程" min-width="300"><template #default="{ row }"><span class="plan-preview">{{ processPreviewRow(row) }}</span></template></el-table-column>
        <el-table-column label="更新时间" width="170"><template #default="{ row }">{{ formatTime(row.updatedAt) }}</template></el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openPreviewRow(row)">查看/导出</el-button>
            <el-button v-if="canManagePlanRow(row)" link type="primary" @click="openEditRow(row)">编辑</el-button>
            <el-button v-if="canManageLessonPlans && row.source === 'SYSTEM'" link type="success" @click="copyPlanAsPersonal(row)">复制为个人</el-button>
            <el-button v-if="canManagePlanRow(row)" link type="danger" @click="removePlanRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog
      v-model="visible"
      :title="editingId ? '编辑结构化教案' : '录入结构化教案'"
      width="min(1380px, 98vw)"
      top="1vh"
      class="lesson-plan-dialog"
      destroy-on-close
    >
      <div class="ai-generator">
        <div class="ai-generator__toolbar">
          <el-select v-model="aiConfigId" placeholder="自动选择模型" clearable class="ai-model-select">
            <el-option v-for="item in configurations" :key="item.id" :label="`${item.name} · ${item.model}`" :value="item.id" />
          </el-select>
          <el-select
            v-model="selectedPromptTemplateId"
            placeholder="选择生成模板"
            class="ai-prompt-select"
            :loading="promptTemplatesLoading"
            @change="selectPromptTemplate"
          >
            <el-option
              v-for="item in promptTemplates"
              :key="item.id"
              :label="`${item.source === 'SYSTEM' ? '系统' : '个人'} · ${item.name}`"
              :value="item.id"
            />
          </el-select>
          <el-button @click="promptDialogVisible = true">管理生成模板</el-button>
          <span class="ai-generator__quality">详案模式 · 质量不足时自动补全一次（最多调用模型 2 次）</span>
          <el-button type="primary" :loading="generating" @click="generate">生成完整教案</el-button>
        </div>
        <el-input
          v-model="aiRequirements"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          maxlength="2000"
          show-word-limit
          placeholder="本次补充要求：班级基础、课型、教学偏好、必须使用的例题/实验/文本等（长要求请保存为个人模板）"
        />
        <p v-if="selectedPromptTemplate" class="ai-generator__template-note">
          当前模板：<strong>{{ selectedPromptTemplate.name }}</strong>
          <span>{{ compactPromptPreview(selectedPromptTemplate.templateContent) }}</span>
          <small>输出 {{ selectedPromptTemplate.maxTokens ? `${selectedPromptTemplate.maxTokens} Token` : '自动' }}</small>
        </p>
      </div>
      <el-alert
        title="以教学过程为主体：基本信息、目标、内容和方法保持紧凑；低频栏目按需展开。AI 会逐项生成可直接授课的师生活动并核对课时。"
        type="info"
        :closable="false"
        show-icon
      />

      <div class="editor-collapse-toolbar">
        <span class="muted">AI 教案分区展示</span>
        <div>
          <el-button link type="primary" @click="expandAllEditorSections">展开全部</el-button>
          <el-button link @click="editorSections = []">收起全部</el-button>
        </div>
      </div>
      <el-form label-position="top">
        <el-collapse v-model="editorSections" class="lesson-plan-form">
          <el-collapse-item name="basic">
            <template #title><strong>基本信息</strong><span class="collapse-note">课时表示整节课总时长</span></template>
            <section class="plan-editor-section">
          <div class="form-grid four">
            <el-form-item label="教案来源">
              <el-select v-model="form.source" :disabled="!canManageSystemPlans" style="width:100%">
                <el-option label="个人教案" value="PERSONAL" />
                <el-option label="系统通用教案" value="SYSTEM" />
              </el-select>
            </el-form-item>
            <el-form-item label="上传者/作者"><el-input :model-value="form.authorName" disabled /></el-form-item>
            <el-form-item label="课程">
              <el-select v-model="form.courseId" filterable style="width:100%" @change="loadKnowledgePoints">
                <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="课程知识点（可选）">
              <el-select v-model="form.knowledgePointId" filterable clearable style="width:100%" placeholder="可依据知识点生成">
                <el-option v-for="point in knowledgePoints" :key="point.id" :label="point.name" :value="point.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="课题/主题"><el-input v-model="form.theme" placeholder="可使用知识点名称" /></el-form-item>
            <el-form-item label="年级/学习对象"><el-input v-model="form.gradeLevel" placeholder="例如：七年级" /></el-form-item>
            <el-form-item label="总课时（分钟）">
              <el-input-number v-model="form.durationMinutes" :min="1" :max="300" :precision="0" :step="5" controls-position="right" />
            </el-form-item>
            <el-form-item label="计划上课时间">
              <el-date-picker v-model="form.scheduledAt" type="datetime" value-format="YYYY-MM-DD HH:mm:ss" placeholder="通用教案可暂不填写" style="width:100%" />
            </el-form-item>
            <el-form-item label="上课地点"><el-input v-model="form.classroom" placeholder="例如：教学楼 A203 / 在线课堂" /></el-form-item>
            <el-form-item label="授课教师"><el-input v-model="form.instructorName" placeholder="实际授课教师，可与上传者不同" /></el-form-item>
            <el-form-item label="学情分析" class="span-two"><el-input v-model="form.learnerAnalysis" type="textarea" :rows="3" /></el-form-item>
          </div>
            </section>
          </el-collapse-item>

          <el-collapse-item name="objectives">
            <template #title><strong>教学目标</strong><span class="collapse-note">目标明确、可观察、可评价</span></template>
            <section class="plan-editor-section">
          <div class="form-grid two">
            <el-form-item label="知识与技能目标"><el-input v-model="form.knowledgeObjectives" type="textarea" :rows="4" /></el-form-item>
            <el-form-item label="过程与方法目标"><el-input v-model="form.processObjectives" type="textarea" :rows="4" /></el-form-item>
            <details class="optional-goals span-two">
              <summary>
                <span><strong>可选目标</strong><small>情感态度价值观与核心素养，仅在确有教学价值时填写</small></span>
                <span>{{ optionalGoalCount ? `已填写 ${optionalGoalCount} 项` : '未填写' }}</span>
              </summary>
              <div class="form-grid two optional-goals__body">
                <el-form-item label="情感态度与价值观目标（可选）"><el-input v-model="form.valueObjectives" type="textarea" :rows="3" /></el-form-item>
                <el-form-item label="学科核心素养（可选）"><el-input v-model="form.coreCompetencies" type="textarea" :rows="3" /></el-form-item>
              </div>
            </details>
          </div>
            </section>
          </el-collapse-item>

          <el-collapse-item name="content">
            <template #title><strong>教学内容</strong><span class="collapse-note">讲授内容及重点、难点、疑点</span></template>
            <section class="plan-editor-section">
              <div class="form-grid two">
                <el-form-item label="教学内容" class="span-two"><el-input v-model="form.teachingContent" type="textarea" :rows="4" placeholder="本节课具体讲授内容、知识结构与范围" /></el-form-item>
                <el-form-item label="教学重点"><el-input v-model="form.keyPoints" type="textarea" :rows="3" /></el-form-item>
                <el-form-item label="教学难点"><el-input v-model="form.difficultPoints" type="textarea" :rows="3" /></el-form-item>
                <el-form-item label="教学疑点（可选）" class="span-two"><el-input v-model="form.doubtfulPoints" type="textarea" :rows="2" placeholder="容易混淆、产生疑问或需要辨析的内容" /></el-form-item>
              </div>
            </section>
          </el-collapse-item>

          <el-collapse-item name="methods">
            <template #title><strong>教学方法</strong><span class="collapse-note">方法、手段与必要准备</span></template>
            <section class="plan-editor-section">
              <div class="form-grid three">
                <el-form-item label="教学方法"><el-input v-model="form.teachingMethods" type="textarea" :rows="3" placeholder="讲授法、讨论法、实验法、案例分析法等" /></el-form-item>
                <el-form-item label="教学手段"><el-input v-model="form.teachingMeans" type="textarea" :rows="3" placeholder="多媒体课件、实物展示、实验器材、小组合作等" /></el-form-item>
                <el-form-item label="教学准备"><el-input v-model="form.preparation" type="textarea" :rows="3" placeholder="教师与学生课前需要完成的准备" /></el-form-item>
              </div>
            </section>
          </el-collapse-item>

          <el-collapse-item name="process">
            <template #title><strong>教学过程</strong><span class="collapse-note">{{ form.teachingProcess.length }} 个环节 · 已分配 {{ allocatedMinutes }} 分钟</span></template>
            <section class="plan-editor-section process-editor-section">
              <LessonPlanStageEditor
                v-model="form.teachingProcess"
                :total-minutes="form.durationMinutes"
                :regenerating-id="regeneratingStageId"
                :allocating-time="allocatingTime"
                :process-presets="processPresets"
                :selected-preset-id="selectedProcessPresetId"
                :preserve-structure="preserveTeachingProcess"
                @regenerate="regenerateStage"
                @allocate-time="allocateTeachingProcessTime"
                @select-preset="selectedProcessPresetId = $event"
                @apply-preset="applyProcessPreset"
                @save-preset="saveCurrentProcessPreset"
                @remove-preset="removeProcessPreset"
                @update:preserve-structure="preserveTeachingProcess = $event"
              />
              <details class="process-supplement">
                <summary>
                  <span><strong>课后与反思</strong><small>按需填写，不作为教学过程的强制模块</small></span>
                  <span>{{ processSupplementCount ? `已填写 ${processSupplementCount} 项` : '未填写' }}</span>
                </summary>
                <div class="form-grid two process-supplement__body">
                  <el-form-item label="课后作业"><el-input v-model="form.homework" type="textarea" :rows="3" /></el-form-item>
                  <el-form-item label="整体学习评价"><el-input v-model="form.assessment" type="textarea" :rows="3" /></el-form-item>
                  <el-form-item label="板书设计"><el-input v-model="form.boardDesign" type="textarea" :rows="4" /></el-form-item>
                  <el-form-item label="教学反思（课后补充）"><el-input v-model="form.reflection" type="textarea" :rows="4" /></el-form-item>
                </div>
              </details>
            </section>
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer>
        <span class="dialog-time-summary" :class="{ invalid: remainingMinutes !== 0 }">
          总课时 {{ form.durationMinutes }} 分钟 · 已分配 {{ allocatedMinutes }} 分钟
        </span>
        <el-button @click="visible=false">取消</el-button>
        <el-button type="primary" @click="savePlan">保存教案</el-button>
      </template>
    </el-dialog>

    <LessonPlanPromptTemplateDialog
      v-model="promptDialogVisible"
      :templates="promptTemplates"
      :selected-id="selectedPromptTemplateId"
      :loading="promptTemplatesLoading"
      @select="selectPromptTemplate"
      @saved="upsertPromptTemplate"
      @removed="removePromptTemplateFromList"
    />

    <el-dialog v-model="previewVisible" title="教案表格预览" width="min(1120px, 96vw)" top="3vh" class="lesson-plan-preview-dialog">
      <el-alert
        title="表格内容与导出内容保持一致；点击“打印 / 保存 PDF”后，可在系统打印窗口中直接打印或选择“另存为 PDF”。"
        type="info"
        :closable="false"
        show-icon
      />
      <div v-if="previewPlan" ref="previewDocumentElement" class="lesson-plan-preview-shell">
        <LessonPlanDocument :plan="previewPlan" :context="previewContext" />
      </div>
      <template #footer>
        <el-button @click="previewVisible=false">关闭</el-button>
        <el-button v-if="previewPlan && canManagePlan(previewPlan)" @click="editPreviewPlan">编辑教案</el-button>
        <el-button v-if="previewPlan" :loading="exportingExcel" @click="exportPreviewExcel">导出 Excel</el-button>
        <el-button v-if="previewPlan" type="primary" @click="printPreview">打印 / 保存 PDF</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getCurrentUser } from '../../../api';
import { generateAiSummary, listAiConfigurations } from '../../ai/api';
import type { AiProviderConfig } from '../../ai/models';
import { getKnowledgeTree } from '../../platform/api';
import LessonPlanDocument from './LessonPlanDocument.vue';
import LessonPlanPromptTemplateDialog from './LessonPlanPromptTemplateDialog.vue';
import LessonPlanStageEditor from './LessonPlanStageEditor.vue';
import {
  createLessonPlanProcessPreset,
  listLessonPlanPromptTemplates,
  listLessonPlanProcessPresets,
  removeLessonPlanProcessPreset,
  type LessonPlanProcessPreset,
  type LessonPlanPromptTemplate,
} from '../api';
import {
  buildLessonPlanDocument,
  exportLessonPlanExcel,
  printLessonPlan,
} from '../composables/lessonPlanDocument';
import {
  buildFullLessonPlanPrompt,
  buildStageLessonPlanPrompt,
  buildTimeAllocationPrompt,
  formatTeachingProcessIssues,
  LESSON_PLAN_STAGE_SYSTEM_INSTRUCTION,
  LESSON_PLAN_SYSTEM_INSTRUCTION,
  LESSON_PLAN_TIME_ALLOCATION_INSTRUCTION,
  mergeGeneratedStage,
  mergeRepairedTeachingProcess,
  normalizeGeneratedTeachingProcess,
  alignGeneratedTeachingProcess,
  repairTeachingProcessPrompt,
  normalizeGeneratedLessonPlanText,
  validateDetailedTeachingProcess,
  type LessonPlanPromptContext,
} from '../composables/lessonPlanGeneration';
import {
  allocateLessonPlanStageDurations,
  normalizeAiLessonPlanDurations,
} from '../composables/lessonPlanTimeAllocation';
import { parseStructuredAiOutput, pickStructuredText } from '../composables/structuredAiOutput';
import { hasAnyPermission } from '../../../access';
import {
  createTeachingProcessStage,
  createSuggestedTeachingProcess,
  emptyLessonPlan,
  lessonPlanSearchText,
  normalizeTeachingProcess,
  teachingProcessDuration,
  useLessonPlanCatalog,
  type LessonPlan,
  type LessonPlanEditable,
  type LessonPlanSource,
  type TeachingProcessStage,
} from '../composables/useLessonPlanCatalog';

type Course = { id: string; name: string };
type KnowledgePoint = { id: string; name: string; children?: KnowledgePoint[] };
type CurrentUser = {
  id?: string;
  username?: string;
  realName?: string | null;
  userType?: string | null;
  permissions?: string[];
};
const props = defineProps<{ courses: Course[] }>();
const route = useRoute();
const currentUser = getCurrentUser() as CurrentUser | null;
const currentAuthorId = String(currentUser?.id || currentUser?.username || 'current-user');
const currentAuthorName = String(currentUser?.realName || currentUser?.username || '当前教师');
const canManageLessonPlans = hasAnyPermission(currentUser, ['lesson-plan:manage']);
const canManageSystemPlans = canManageLessonPlans && ['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.userType || '');
const { plans, load, save, remove } = useLessonPlanCatalog();
const catalogReady = ref(false);
const configurations = ref<AiProviderConfig[]>([]);
const knowledgePoints = ref<KnowledgePoint[]>([]);
const courseFilter = ref('');
const sourceFilter = ref<LessonPlanSource | ''>('');
const keyword = ref('');
const visible = ref(false);
const editingId = ref('');
const generating = ref(false);
const regeneratingStageId = ref('');
const allocatingTime = ref(false);
const previewVisible = ref(false);
const previewPlanId = ref('');
const previewKnowledgePointName = ref('');
const previewDocumentElement = ref<HTMLElement | null>(null);
const exportingExcel = ref(false);
const handledRouteEntry = ref('');
const aiConfigId = ref('');
const aiRequirements = ref('');
const promptTemplates = ref<LessonPlanPromptTemplate[]>([]);
const promptTemplatesLoading = ref(false);
const promptDialogVisible = ref(false);
const selectedPromptTemplateId = ref(readLocalText(`lesson-plan-prompt-template-v1:${currentAuthorId}`));
const processPresets = ref<LessonPlanProcessPreset[]>([]);
const selectedProcessPresetId = ref('');
const preserveTeachingProcess = ref(false);
const editorSectionNames = ['basic', 'objectives', 'content', 'methods', 'process'];
const editorSections = ref([...editorSectionNames]);
const form = reactive<LessonPlanEditable>(emptyLessonPlan());
const generatedTextKeys = [
  'gradeLevel', 'learnerAnalysis', 'knowledgeObjectives', 'processObjectives', 'valueObjectives',
  'coreCompetencies', 'teachingContent', 'keyPoints', 'difficultPoints', 'doubtfulPoints',
  'teachingMethods', 'teachingMeans', 'preparation',
  'homework', 'assessment', 'boardDesign', 'reflection',
];
const filteredPlans = computed(() => plans.value.filter((item) => (!courseFilter.value || item.courseId === courseFilter.value)
  && (!sourceFilter.value || item.source === sourceFilter.value)
  && (!keyword.value || lessonPlanSearchText(item).includes(keyword.value.toLowerCase()))));
const previewPlan = computed(() => plans.value.find((item) => item.id === previewPlanId.value));
const previewContext = computed(() => ({
  courseName: previewPlan.value ? courseName(previewPlan.value.courseId) : '',
  knowledgePointName: previewKnowledgePointName.value,
}));
const selectedPromptTemplate = computed(() =>
  promptTemplates.value.find((item) => item.id === selectedPromptTemplateId.value) || null);
const allocatedMinutes = computed(() => teachingProcessDuration(form.teachingProcess));
const remainingMinutes = computed(() => form.durationMinutes - allocatedMinutes.value);
const optionalGoalCount = computed(() => [form.valueObjectives, form.coreCompetencies].filter((item) => item.trim()).length);
const processSupplementCount = computed(() =>
  [form.homework, form.assessment, form.boardDesign, form.reflection].filter((item) => item.trim()).length);

async function openCreate(preset?: { courseId?: string; knowledgePointId?: string }) {
  editingId.value = '';
  Object.assign(form, emptyLessonPlan(), {
    source: 'PERSONAL',
    authorId: currentAuthorId,
    authorName: currentAuthorName,
    instructorName: currentAuthorName,
    courseId: preset?.courseId || props.courses[0]?.id || '',
    knowledgePointId: preset?.knowledgePointId,
    teachingProcess: createSuggestedTeachingProcess(),
  });
  aiRequirements.value = '';
  selectedProcessPresetId.value = '';
  preserveTeachingProcess.value = false;
  expandAllEditorSections();
  visible.value = true;
  await Promise.all([loadKnowledgePoints(), loadConfigurations(), loadPromptTemplates(), loadProcessPresets()]);
}

async function openEdit(plan: LessonPlan) {
  if (!canManagePlan(plan)) return ElMessage.warning('系统教案或其他教师的个人教案不可直接修改，请先复制为个人教案');
  const editable = editablePlanCopy(plan);
  editingId.value = plan.id;
  Object.assign(form, emptyLessonPlan(), editable, {
    teachingProcess: normalizeTeachingProcess(plan.teachingProcess),
  });
  aiRequirements.value = '';
  selectedProcessPresetId.value = '';
  preserveTeachingProcess.value = true;
  expandAllEditorSections();
  visible.value = true;
  await Promise.all([loadKnowledgePoints(), loadConfigurations(), loadPromptTemplates(), loadProcessPresets()]);
}

const openEditRow = (row: unknown) => openEdit(row as LessonPlan);

async function copyPlanAsPersonal(row: unknown) {
  const plan = row as LessonPlan;
  const editable = editablePlanCopy(plan);
  editingId.value = '';
  Object.assign(form, emptyLessonPlan(), editable, {
    source: 'PERSONAL',
    authorId: currentAuthorId,
    authorName: currentAuthorName,
    teachingProcess: normalizeTeachingProcess(plan.teachingProcess),
  });
  aiRequirements.value = '';
  selectedProcessPresetId.value = '';
  preserveTeachingProcess.value = true;
  expandAllEditorSections();
  visible.value = true;
  await Promise.all([loadKnowledgePoints(), loadConfigurations(), loadPromptTemplates(), loadProcessPresets()]);
  ElMessage.success('已复制为个人教案，可修改后另存为新教案');
}

async function openPreview(plan: LessonPlan) {
  previewPlanId.value = plan.id;
  previewKnowledgePointName.value = plan.knowledgePointName
    || (plan.knowledgePointId ? '已关联课程知识点' : '通用教案');
  previewVisible.value = true;
}

const openPreviewRow = (row: unknown) => openPreview(row as LessonPlan);

function editPreviewPlan() {
  if (!previewPlan.value) return;
  const plan = previewPlan.value;
  previewVisible.value = false;
  void openEdit(plan);
}

async function exportPreviewExcel() {
  if (!previewPlan.value) return;
  exportingExcel.value = true;
  try {
    await exportLessonPlanExcel(buildLessonPlanDocument(previewPlan.value, previewContext.value));
    ElMessage.success('Excel 教案已导出');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'Excel 导出失败');
  } finally {
    exportingExcel.value = false;
  }
}

function printPreview() {
  if (!previewPlan.value) return;
  const element = previewDocumentElement.value?.querySelector<HTMLElement>('.lesson-plan-document');
  if (!element) return ElMessage.error('教案表格尚未加载完成');
  try {
    printLessonPlan(element, buildLessonPlanDocument(previewPlan.value, previewContext.value));
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '打印窗口打开失败');
  }
}

async function loadConfigurations() {
  if (!configurations.value.length) configurations.value = (await listAiConfigurations()).filter((item) => item.enabled);
  aiConfigId.value ||= configurations.value.find((item) => item.isDefault)?.id || configurations.value[0]?.id || '';
}

async function loadPromptTemplates(force = false) {
  if (promptTemplates.value.length && !force) return;
  promptTemplatesLoading.value = true;
  try {
    promptTemplates.value = await listLessonPlanPromptTemplates();
    const selectedExists = promptTemplates.value.some((item) => item.id === selectedPromptTemplateId.value);
    if (!selectedExists) selectPromptTemplate(promptTemplates.value[0]?.id || '');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教案生成模板加载失败');
  } finally {
    promptTemplatesLoading.value = false;
  }
}

function selectPromptTemplate(value: unknown) {
  const id = typeof value === 'string' ? value : '';
  selectedPromptTemplateId.value = id;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(`lesson-plan-prompt-template-v1:${currentAuthorId}`, id);
  }
}

function upsertPromptTemplate(template: LessonPlanPromptTemplate) {
  const index = promptTemplates.value.findIndex((item) => item.id === template.id);
  if (index < 0) promptTemplates.value = [...promptTemplates.value, template];
  else promptTemplates.value = promptTemplates.value.map((item) => item.id === template.id ? template : item);
  selectPromptTemplate(template.id);
}

function removePromptTemplateFromList(id: string) {
  promptTemplates.value = promptTemplates.value.filter((item) => item.id !== id);
  if (selectedPromptTemplateId.value === id) selectPromptTemplate(promptTemplates.value[0]?.id || '');
}

async function loadProcessPresets(force = false) {
  if (processPresets.value.length && !force) return;
  try {
    processPresets.value = await listLessonPlanProcessPresets();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教学流程预设加载失败');
  }
}

async function applyProcessPreset(id: string) {
  const preset = processPresets.value.find((item) => item.id === id);
  if (!preset) return ElMessage.warning('未找到所选教学流程预设');
  const hasWrittenContent = form.teachingProcess.some((stage) =>
    [stage.teacherActivity, stage.studentActivity, stage.coreQuestion, stage.assessment, stage.designIntent, stage.resources]
      .some((value) => value.trim()));
  if (hasWrittenContent) {
    const confirmed = await ElMessageBox.confirm(
      '应用流程预设会替换当前环节编排及已填写的环节内容，是否继续？',
      '应用教学流程预设',
      { type: 'warning', confirmButtonText: '继续应用', cancelButtonText: '取消' },
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
  }
  form.teachingProcess = preset.stages.map((stage) => createTeachingProcessStage(stage));
  selectedProcessPresetId.value = preset.id;
  preserveTeachingProcess.value = true;
  const minutes = teachingProcessDuration(form.teachingProcess);
  ElMessage.success(minutes === form.durationMinutes
    ? `已应用“${preset.name}”，AI 将保持当前环节编排`
    : `已应用“${preset.name}”，环节共 ${minutes} 分钟，请调整至总课时 ${form.durationMinutes} 分钟`);
}

async function saveCurrentProcessPreset() {
  if (!form.teachingProcess.length) return ElMessage.warning('请先添加教学环节');
  if (form.teachingProcess.some((stage) => !stage.title.trim() || !Number.isInteger(stage.duration) || stage.duration <= 0)) {
    return ElMessage.warning('保存预设前，请填写每个环节的名称和正整数分钟数');
  }
  const result = await ElMessageBox.prompt(
    '仅保存环节名称、顺序和时间；当前学科内容不会写入流程预设。',
    '保存当前教学编排',
    {
      inputPlaceholder: '例如：我的 45 分钟讲练课',
      inputPattern: /\S/u,
      inputErrorMessage: '请输入预设名称',
      confirmButtonText: '保存预设',
      cancelButtonText: '取消',
    },
  ).catch(() => null);
  const name = result?.value?.trim();
  if (!name) return;
  try {
    const created = await createLessonPlanProcessPreset({
      name,
      stages: form.teachingProcess.map((stage) => ({ title: stage.title.trim(), duration: stage.duration })),
    });
    processPresets.value = [...processPresets.value, created];
    selectedProcessPresetId.value = created.id;
    preserveTeachingProcess.value = true;
    ElMessage.success('个人教学流程预设已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教学流程预设保存失败');
  }
}

async function removeProcessPreset(id: string) {
  const preset = processPresets.value.find((item) => item.id === id);
  if (!preset?.canManage) return ElMessage.warning('系统流程预设不可删除');
  const confirmed = await ElMessageBox.confirm(
    `确认删除个人流程预设“${preset.name}”？`,
    '删除教学流程预设',
    { type: 'warning' },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  try {
    await removeLessonPlanProcessPreset(id);
    processPresets.value = processPresets.value.filter((item) => item.id !== id);
    if (selectedProcessPresetId.value === id) selectedProcessPresetId.value = '';
    ElMessage.success('教学流程预设已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教学流程预设删除失败');
  }
}

async function loadKnowledgePoints() {
  knowledgePoints.value = form.courseId ? flattenPoints(await getKnowledgeTree(form.courseId) as unknown as KnowledgePoint[]) : [];
  if (form.knowledgePointId && !knowledgePoints.value.some((item) => item.id === form.knowledgePointId)) form.knowledgePointId = undefined;
}

async function generate() {
  const topic = form.theme.trim() || knowledgePointName();
  if (!form.courseId || !topic) return ElMessage.warning('请选择课程，并填写课题或选择课程知识点');
  if (preserveTeachingProcess.value && remainingMinutes.value !== 0) {
    return ElMessage.warning(
      `当前已锁定教学流程，但环节合计 ${allocatedMinutes.value} 分钟与总课时 ${form.durationMinutes} 分钟不一致，请先调整时间`,
    );
  }
  generating.value = true;
  try {
    await Promise.all([loadConfigurations(), loadPromptTemplates()]);
    if (!await confirmGenerationLimit()) return;
    const context = lessonPlanPromptContext(topic);
    const result = await generateAiSummary({
      configId: aiConfigId.value || undefined,
      content: buildFullLessonPlanPrompt(context),
      instruction: LESSON_PLAN_SYSTEM_INSTRUCTION,
      maxTokens: generationOutputLimit(),
    });
    const parsed = parseStructuredAiOutput(result.summary);
    const generatedStages = normalizeGeneratedTeachingProcess(normalizeTeachingProcess(parsed.teachingProcess));
    let stages = preserveTeachingProcess.value
      ? alignGeneratedTeachingProcess(form.teachingProcess, generatedStages)
      : generatedStages;
    if (!stages.length) throw new Error('AI 未返回有效的教学环节，请重试');
    let qualityIssues = validateDetailedTeachingProcess(stages, form.durationMinutes);
    if (qualityIssues.length) {
      ElMessage.info('初次结果细节不足，AI 正在自动补全教学过程');
      const repairResult = await generateAiSummary({
        configId: aiConfigId.value || undefined,
        content: repairTeachingProcessPrompt({ context, stages, issues: qualityIssues }),
        instruction: LESSON_PLAN_SYSTEM_INSTRUCTION,
        maxTokens: generationOutputLimit(),
      });
      const repaired = parseStructuredAiOutput(repairResult.summary);
      const repairedStages = normalizeGeneratedTeachingProcess(normalizeTeachingProcess(repaired.teachingProcess));
      stages = mergeRepairedTeachingProcess(stages, repairedStages, qualityIssues);
      qualityIssues = validateDetailedTeachingProcess(stages, form.durationMinutes);
      if (qualityIssues.length) {
        throw new Error(`AI 教学过程仍不够详细：${formatTeachingProcessIssues(qualityIssues)}。请调整生成模板或单独重生成对应环节`);
      }
    }
    const generatedText = Object.fromEntries(
      Object.entries(pickStructuredText(parsed, generatedTextKeys))
        .map(([key, value]) => [key, normalizeGeneratedLessonPlanText(value)]),
    );
    Object.assign(form, generatedText, {
      theme: form.theme.trim() || topic,
      teachingProcess: stages,
    });
    expandAllEditorSections();
    ElMessage.success('AI 已生成可直接授课的详细教案，教学过程与课时已通过质检');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '结构化教案生成失败');
  } finally {
    generating.value = false;
  }
}

async function allocateTeachingProcessTime(strategy: 'PROPORTIONAL' | 'AI') {
  if (allocatingTime.value) return;
  const feasibility = allocateLessonPlanStageDurations(
    form.durationMinutes,
    form.teachingProcess.map(() => 1),
  );
  if (!feasibility.ok) return ElMessage.warning(feasibility.message);

  if (strategy === 'PROPORTIONAL') {
    const allocation = allocateLessonPlanStageDurations(
      form.durationMinutes,
      form.teachingProcess.map((stage) => Number(stage.duration)),
    );
    if (!allocation.ok) return ElMessage.warning(allocation.message);
    applyTeachingProcessDurations(allocation.durations);
    ElMessage.success(`已按当前比例重新分配，共 ${form.durationMinutes} 分钟`);
    return;
  }

  const snapshot = form.teachingProcess.map((stage) => ({
    id: stage.id,
    title: stage.title.trim(),
  }));
  allocatingTime.value = true;
  try {
    await loadConfigurations();
    const configuration = configurations.value.find((item) => item.id === aiConfigId.value);
    const result = await generateAiSummary({
      configId: aiConfigId.value || undefined,
      content: buildTimeAllocationPrompt({
        courseName: courseName(form.courseId),
        topic: form.theme.trim() || knowledgePointName(),
        gradeLevel: form.gradeLevel,
        totalMinutes: form.durationMinutes,
        stages: form.teachingProcess,
      }),
      instruction: LESSON_PLAN_TIME_ALLOCATION_INSTRUCTION,
      maxTokens: Math.min(800, configuration?.maxTokens ?? 800),
    });
    const parsed = parseStructuredAiOutput(result.summary);
    const rows = parsed.teachingProcess;
    if (!Array.isArray(rows) || rows.length !== snapshot.length) {
      throw new Error('AI 返回的环节数量与当前教案不一致，请重试');
    }
    const proposedDurations = rows.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`AI 返回的第 ${index + 1} 个环节格式不正确`);
      }
      const item = row as Record<string, unknown>;
      if (Number(item.index) !== index + 1) {
        throw new Error('AI 返回的环节索引缺失、重复或顺序不正确，请重试');
      }
      if (String(item.title || '').trim() !== snapshot[index].title) {
        throw new Error(`AI 改动了第 ${index + 1} 个环节名称，已拒绝本次结果`);
      }
      const duration = Number(item.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`AI 返回的“${snapshot[index].title}”时间无效`);
      }
      return duration;
    });
    const unchanged = snapshot.length === form.teachingProcess.length
      && snapshot.every((stage, index) =>
        stage.id === form.teachingProcess[index].id
        && stage.title === form.teachingProcess[index].title.trim());
    if (!unchanged) throw new Error('AI 分配期间环节编排已变化，请重新分配');
    const allocation = normalizeAiLessonPlanDurations(form.durationMinutes, proposedDurations);
    if (!allocation.ok) throw new Error(allocation.message);
    applyTeachingProcessDurations(allocation.durations);
    ElMessage.success(`AI 已按教学任务合理分配，共 ${form.durationMinutes} 分钟`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'AI 时间分配失败');
  } finally {
    allocatingTime.value = false;
  }
}

function applyTeachingProcessDurations(durations: number[]) {
  if (durations.length !== form.teachingProcess.length) {
    throw new Error('时间分配结果与教学环节数量不一致');
  }
  form.teachingProcess = form.teachingProcess.map((stage, index) => ({
    ...stage,
    duration: durations[index],
  }));
  selectedProcessPresetId.value = '';
  preserveTeachingProcess.value = true;
}

async function regenerateStage(stage: TeachingProcessStage) {
  const topic = form.theme.trim() || knowledgePointName();
  if (!topic) return ElMessage.warning('请先填写课题或选择知识点');
  const request = await ElMessageBox.prompt(
    `请说明“${stage.title}”需要增加、删减或调整的内容，AI 将按意见修改并保留环节名称与时长。`,
    '填写 AI 修改意见',
    {
      inputType: 'textarea',
      inputPlaceholder: '例如：增加一个分层例题；把教师讲解改为小组探究；补充学生可能出现的错误及反馈方式',
      inputValidator: (value) => Boolean(value?.trim()) || '请先填写修改意见',
      confirmButtonText: '按意见重新生成',
      cancelButtonText: '取消',
    },
  ).catch(() => null);
  const revisionRequest = request?.value?.trim();
  if (!revisionRequest) return;
  regeneratingStageId.value = stage.id;
  try {
    await Promise.all([loadConfigurations(), loadPromptTemplates()]);
    if (!await confirmGenerationLimit()) return;
    const context = lessonPlanPromptContext(topic);
    const stageIndex = form.teachingProcess.findIndex((item) => item.id === stage.id);
    const adjacentStages = [
      form.teachingProcess[stageIndex - 1] ? `上一环节：${form.teachingProcess[stageIndex - 1].title}` : '',
      form.teachingProcess[stageIndex + 1] ? `下一环节：${form.teachingProcess[stageIndex + 1].title}` : '',
    ].filter(Boolean).join('；');
    const result = await generateAiSummary({
      configId: aiConfigId.value || undefined,
      content: buildStageLessonPlanPrompt({
        context,
        stage,
        knowledgeObjectives: form.knowledgeObjectives,
        learnerAnalysis: form.learnerAnalysis,
        teachingContent: form.teachingContent,
        keyPoints: form.keyPoints,
        difficultPoints: form.difficultPoints,
        teachingMethods: form.teachingMethods,
        adjacentStages,
        revisionRequest,
      }),
      instruction: LESSON_PLAN_STAGE_SYSTEM_INSTRUCTION,
      maxTokens: generationOutputLimit(),
    });
    const candidate = mergeGeneratedStage(stage, parseStructuredAiOutput(result.summary));
    const qualityIssues = validateDetailedTeachingProcess([candidate]);
    if (qualityIssues.length) {
      throw new Error(`该环节仍不够详细：${formatTeachingProcessIssues(qualityIssues)}。请补充本次要求后重试`);
    }
    Object.assign(stage, candidate);
    ElMessage.success(`“${stage.title}”已重新生成`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教学环节生成失败');
  } finally {
    regeneratingStageId.value = '';
  }
}

async function savePlan() {
  const theme = form.theme.trim() || knowledgePointName();
  if (!form.courseId || !theme) return ElMessage.warning('请选择课程，并填写课题或选择知识点');
  if (!Number.isInteger(form.durationMinutes) || form.durationMinutes <= 0) return ElMessage.warning('总课时必须是正整数');
  if (!form.knowledgeObjectives.trim()) return ElMessage.warning('请填写知识与技能目标');
  if (!form.teachingProcess.length) return ElMessage.warning('请至少添加一个教学环节');
  if (form.teachingProcess.some((stage) => !stage.title.trim() || !Number.isInteger(stage.duration) || stage.duration <= 0)) {
    return ElMessage.warning('每个教学环节都必须填写名称和正整数分钟数');
  }
  if (!canManageSystemPlans) form.source = 'PERSONAL';
  if (!editingId.value) {
    form.authorId = currentAuthorId;
    form.authorName = currentAuthorName;
  }
  if (remainingMinutes.value !== 0) {
    const confirmed = await ElMessageBox.confirm(
      `总课时为 ${form.durationMinutes} 分钟，当前环节合计 ${allocatedMinutes.value} 分钟，仍要保存吗？`,
      '课时分配不一致',
      { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '返回调整' },
    ).then(() => true).catch(() => false);
    if (!confirmed) return;
  }
  try {
    await save({
      ...form,
      theme,
      knowledgePointId: form.knowledgePointId || undefined,
      teachingProcess: normalizeTeachingProcess(form.teachingProcess),
    }, editingId.value || undefined);
    visible.value = false;
    ElMessage.success(`${sourceLabel(form.source)}已保存，作者：${form.authorName}`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教案保存失败');
  }
}

async function removePlan(plan: LessonPlan) {
  if (!canManagePlan(plan)) return ElMessage.warning('无权删除该教案');
  const confirmed = await ElMessageBox.confirm(
    `确认删除教案“${plan.theme}”？`,
    '删除教案',
    { type: 'warning' },
  ).then(() => true).catch(() => false);
  if (!confirmed) return;
  try {
    await remove(plan.id);
    ElMessage.success('教案已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教案删除失败');
  }
}

const removePlanRow = (row: unknown) => removePlan(row as LessonPlan);
function courseName(id: string) { return props.courses.find((item) => item.id === id)?.name || '未知课程'; }
function knowledgePointName() { return knowledgePoints.value.find((item) => item.id === form.knowledgePointId)?.name || ''; }
function flattenPoints(items: KnowledgePoint[]): KnowledgePoint[] { return items.flatMap((item) => [item, ...flattenPoints(item.children || [])]); }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function sourceLabel(source: LessonPlanSource) { return source === 'PERSONAL' ? '个人教案' : '系统教案'; }
function editablePlanCopy(plan: LessonPlan): LessonPlanEditable {
  const editable = { ...plan } as Partial<LessonPlan>;
  delete editable.id;
  delete editable.createdAt;
  delete editable.updatedAt;
  delete editable.knowledgePointName;
  return editable as LessonPlanEditable;
}
function generationOutputLimit() {
  return selectedPromptTemplate.value?.maxTokens ?? undefined;
}
async function confirmGenerationLimit() {
  const templateLimit = selectedPromptTemplate.value?.maxTokens;
  const configuration = configurations.value.find((item) => item.id === aiConfigId.value);
  const configurationLimit = configuration?.maxTokens;
  if (!templateLimit || !configurationLimit || templateLimit <= configurationLimit) return true;
  return ElMessageBox.confirm(
    `当前模板计划输出 ${templateLimit} Token，但模型配置上限为 ${configurationLimit} Token。继续后将按模型配置执行，内容可能被截断。`,
    '输出长度超过模型配置',
    {
      type: 'warning',
      confirmButtonText: '继续生成',
      cancelButtonText: '返回修改',
    },
  ).then(() => true).catch(() => false);
}
function lessonPlanPromptContext(topic: string): LessonPlanPromptContext {
  const template = selectedPromptTemplate.value;
  if (!template) throw new Error('请先选择一个教案生成模板');
  return {
    courseName: courseName(form.courseId),
    knowledgePointName: knowledgePointName(),
    topic,
    gradeLevel: form.gradeLevel,
    durationMinutes: form.durationMinutes,
    templateName: template.name,
    templateContent: template.templateContent,
    requirements: aiRequirements.value.trim(),
    processBlueprint: preserveTeachingProcess.value
      ? form.teachingProcess.map((stage) => ({ title: stage.title, duration: stage.duration }))
      : [],
  };
}
function compactPromptPreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 92 ? `${normalized.slice(0, 92)}…` : normalized;
}
function canManagePlan(plan: LessonPlan) {
  return canManageLessonPlans
    && (canManageSystemPlans || (plan.source === 'PERSONAL' && plan.authorId === currentAuthorId));
}
const planRow = (row: unknown) => row as LessonPlan;
const canManagePlanRow = (row: unknown) => canManagePlan(row as LessonPlan);
function expandAllEditorSections() {
  editorSections.value = [...editorSectionNames];
}
function inlinePreviewContext(plan: LessonPlan) {
  return {
    courseName: courseName(plan.courseId),
    knowledgePointName: plan.knowledgePointName
      || (plan.knowledgePointId ? '已关联课程知识点' : '通用教案'),
  };
}
function processPreview(plan: LessonPlan) {
  if (!plan.teachingProcess.length) return '未设置教学环节';
  return `${plan.teachingProcess.length} 个环节 · ${teachingProcessDuration(plan.teachingProcess)} 分钟\n${plan.teachingProcess.map((stage) => stage.title).join(' → ')}`;
}
const processPreviewRow = (row: unknown) => processPreview(row as LessonPlan);

watch(
  () => [route.query.section, route.query.courseId, route.query.knowledgePointId, route.query.planId, props.courses.length, catalogReady.value],
  async () => {
    if (route.query.section !== 'lesson-plans' || !props.courses.length || !catalogReady.value) return;
    const courseId = String(route.query.courseId || '');
    const knowledgePointId = String(route.query.knowledgePointId || '');
    const planId = String(route.query.planId || '');
    if (!courseId && !planId) return;
    const token = `${courseId}:${knowledgePointId}:${planId}`;
    if (handledRouteEntry.value === token) return;
    handledRouteEntry.value = token;
    courseFilter.value = courseId;
    const matchedPlan = planId
      ? plans.value.find((item) => item.id === planId)
      : undefined;
    if (matchedPlan) await openPreview(matchedPlan);
    else await openCreate({ courseId, knowledgePointId });
  },
  { immediate: true },
);

onMounted(async () => {
  try {
    await Promise.all([load(), loadPromptTemplates(), loadProcessPresets()]);
    catalogReady.value = true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '教案目录加载失败');
  }
});

function readLocalText(key: string) {
  return typeof localStorage === 'undefined' ? '' : localStorage.getItem(key) || '';
}
</script>

<style scoped>
:global(.lesson-plan-dialog) { max-height: 98vh; display: flex; flex-direction: column; margin-bottom: 0; overflow: hidden; border-radius: 14px; }
:global(.lesson-plan-dialog .el-dialog__header) { padding: 18px 22px 14px; border-bottom: 1px solid #e7edf5; }
:global(.lesson-plan-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; padding: 16px 22px 22px; background: #f5f7fb; }
:global(.lesson-plan-dialog .el-dialog__footer) { padding: 14px 22px; border-top: 1px solid #e7edf5; background: #fff; }
:global(.lesson-plan-preview-dialog) { max-height: 94vh; display: flex; flex-direction: column; margin-bottom: 0; }
:global(.lesson-plan-preview-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; }
.lesson-plan-library { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.lesson-plan-panel { flex: 1; min-height: 0; }
.lesson-plan-filter { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.lesson-plan-filter { min-height: 58px; padding-bottom: 6px; }
.ai-generator {
  display: grid;
  gap: 9px;
  margin-bottom: 12px;
  padding: 12px 14px;
  border: 1px solid #cfe2ff;
  border-radius: 12px;
  background: linear-gradient(135deg, #f1f7ff 0%, #fbfdff 60%, #f6f3ff 100%);
  box-shadow: 0 5px 18px rgb(37 99 235 / 6%);
}
.ai-generator__toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.ai-model-select { width: 230px; }
.ai-prompt-select { width: 230px; }
.ai-generator__quality { flex: 1; color: #527092; font-size: 12px; text-align: right; white-space: nowrap; }
.ai-generator__template-note { display: flex; align-items: baseline; gap: 6px; margin: 0; color: #527092; font-size: 12px; }
.ai-generator__template-note strong { color: #315b8c; }
.ai-generator__template-note span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-generator__template-note small {
  margin-left: auto;
  padding-left: 8px;
  color: #315b8c;
  white-space: nowrap;
}
.editor-collapse-toolbar {
  position: sticky;
  top: -16px;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  margin: 12px 0 10px;
  padding: 7px 12px;
  border: 1px solid #dfe7f2;
  border-radius: 10px;
  background: rgb(255 255 255 / 96%);
  box-shadow: 0 4px 14px rgb(15 23 42 / 5%);
  backdrop-filter: blur(10px);
}
.lesson-plan-form { display: grid; gap: 12px; border: 0; background: transparent; }
.lesson-plan-form :deep(.el-collapse-item) {
  overflow: hidden;
  border: 1px solid #dfe7f2;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 5px 16px rgb(15 23 42 / 4%);
}
.lesson-plan-form :deep(.el-collapse-item__header) {
  min-height: 56px;
  padding: 0 18px;
  border: 0;
  background: linear-gradient(90deg, #fff 0%, #f8fbff 100%);
  color: #21324a;
  font-size: 16px;
}
.lesson-plan-form :deep(.el-collapse-item__wrap) { border: 0; }
.lesson-plan-form :deep(.el-collapse-item__content) { padding: 0; color: inherit; }
.collapse-note { margin-left: 14px; color: #75849a; font-size: 13px; font-weight: 400; }
.plan-editor-section { padding: 16px 18px 4px; border-top: 1px solid #edf1f6; background: #fbfcfe; }
.process-editor-section { padding-bottom: 18px; }
.form-grid { display: grid; gap: 0 18px; }
.form-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.form-grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.form-grid.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.form-grid .span-two { grid-column: span 2; }
.plan-editor-section :deep(.el-form-item) { margin-bottom: 15px; }
.plan-editor-section :deep(.el-form-item__label) { padding-bottom: 7px; color: #334155; font-weight: 600; line-height: 1.3; }
.plan-editor-section :deep(.el-textarea__inner) { min-height: 82px !important; line-height: 1.65; resize: vertical; }
.optional-goals,
.process-supplement {
  overflow: hidden;
  margin-bottom: 14px;
  border: 1px solid #dfe7f2;
  border-radius: 9px;
  background: #fff;
}
.optional-goals summary,
.process-supplement summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  padding: 8px 13px;
  color: #41556e;
  cursor: pointer;
  list-style: none;
}
.optional-goals summary::-webkit-details-marker,
.process-supplement summary::-webkit-details-marker { display: none; }
.optional-goals summary > span:first-child,
.process-supplement summary > span:first-child { display: flex; align-items: baseline; gap: 9px; }
.optional-goals summary small,
.process-supplement summary small,
.optional-goals summary > span:last-child,
.process-supplement summary > span:last-child { color: #7a899c; font-size: 12px; font-weight: 400; }
.optional-goals__body,
.process-supplement__body { padding: 12px 13px 0; border-top: 1px solid #edf1f6; background: #fbfcfe; }
.process-supplement { margin-top: 16px; margin-bottom: 0; }
.plan-preview { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: pre-line; }
.dialog-time-summary { margin-right: 12px; color: var(--el-color-success); }
.dialog-time-summary.invalid { color: var(--el-color-warning); }
.lesson-plan-preview-shell { margin-top: 14px; padding: 22px; border: 1px solid #d1d5db; background: #fff; }
.inline-plan-preview {
  width: min(1040px, calc(100vw - 180px));
  margin: 10px auto 14px;
  padding: 24px;
  border: 1px solid #dfe6ef;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 7px 24px rgb(15 23 42 / 7%);
}
@media (max-width: 1080px) {
  .form-grid.three,
  .form-grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-generator__quality { display: none; }
}
@media (max-width: 820px) {
  .form-grid.two, .form-grid.three, .form-grid.four { grid-template-columns: 1fr; }
  .form-grid .span-two { grid-column: auto; }
  .ai-generator__toolbar { align-items: stretch; flex-direction: column; }
  .ai-generator__toolbar > * { width: 100% !important; }
  .ai-generator__template-note span { white-space: normal; }
  .ai-generator__template-note small { margin-left: 0; }
  .collapse-note { display: none; }
  .editor-collapse-toolbar { top: -16px; }
  .lesson-plan-preview-shell { padding: 8px; overflow-x: auto; }
  .lesson-plan-preview-shell :deep(.lesson-plan-document) { min-width: 820px; }
  .inline-plan-preview { width: calc(100vw - 54px); padding: 8px; overflow-x: auto; }
  .inline-plan-preview :deep(.lesson-plan-document) { min-width: 820px; }
}
</style>
