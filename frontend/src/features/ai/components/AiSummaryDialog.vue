<template>
  <el-dialog
    v-model="visible"
    :title="`AI ${kindLabel} · ${subjectName}`"
    width="min(1120px, 94vw)"
    top="5vh"
    class="ai-summary-modal"
    destroy-on-close
  >
    <div v-loading="loading" class="ai-summary-dialog">
      <el-alert
        :title="summaryKind === 'lesson'
          ? 'AI 只整理教师草稿；应用到教学记录并人工检查后，仍需走教学记录发布流程。'
          : '统计预览始终来自确定性查询；AI 只生成草稿，必须人工审核后才能发布。'"
        type="info"
        show-icon
        :closable="false"
      />

      <section v-if="summaryKind === 'student' || summaryKind === 'class' || summaryKind === 'parent_report'" class="ai-summary-scope">
        <div class="scope-field scope-domains">
          <span class="scope-label">总结内容（可单选或多选）</span>
          <el-checkbox-group v-model="scope.summaryDomains">
            <el-checkbox value="lessons">上课</el-checkbox>
            <el-checkbox value="exams">考试</el-checkbox>
            <el-checkbox value="homework">作业</el-checkbox>
          </el-checkbox-group>
        </div>
        <div class="scope-field scope-range">
          <span class="scope-label">时间范围（留空不限制）</span>
          <el-date-picker
            v-model="scopeDateRange"
            type="datetimerange"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            range-separator="至"
            unlink-panels
            style="width: 390px"
          />
        </div>
        <div class="scope-field scope-count">
          <span class="scope-label">最近考试次数（留空不限制）</span>
          <div class="scope-count-control">
            <el-input-number
              v-model="scope.recentExamCount"
              :min="1"
              :step="1"
              :disabled="!scope.summaryDomains?.includes('exams')"
              placeholder="不限"
              style="width: 140px"
            />
            <el-button
              v-if="scope.recentExamCount !== undefined"
              link
              :disabled="!scope.summaryDomains?.includes('exams')"
              @click="scope.recentExamCount = undefined"
            >
              不限
            </el-button>
          </div>
        </div>
        <el-button type="primary" plain :loading="loading" @click="applySummaryScope">应用范围并刷新预览</el-button>
        <span class="muted">先按时间筛选，再取最近 N 场考试；作业与上课按所属课次时间筛选。</span>
      </section>

      <div v-if="preview" class="ai-summary-metrics">
        <template v-if="isExamPreview(preview)">
          <div><span>提交</span><strong>{{ preview.participation.submitted.value }}</strong></div>
          <div><span>已评分</span><strong>{{ preview.participation.graded.value }}</strong></div>
          <div><span>平均分</span><strong>{{ preview.scores.average.value }}</strong></div>
          <div><span>中位数</span><strong>{{ preview.scores.median.value }}</strong></div>
          <div><span>题目</span><strong>{{ preview.questions.length }}</strong></div>
          <div><span>证据</span><strong>{{ preview.evidence.length }}</strong></div>
        </template>
        <template v-else-if="isStudentPreview(preview)">
          <div><span>选择考试</span><strong>{{ preview.coverage.selectedExamCount.value }}</strong></div>
          <div><span>已评分</span><strong>{{ preview.coverage.gradedExamCount.value }}</strong></div>
          <div><span>未提交</span><strong>{{ preview.coverage.notSubmittedExamCount.value }}</strong></div>
          <div><span>未评分</span><strong>{{ preview.coverage.ungradedExamCount.value }}</strong></div>
          <div><span>错题</span><strong>{{ preview.wrongQuestions.length }}</strong></div>
          <div><span>证据</span><strong>{{ preview.evidence.length }}</strong></div>
        </template>
        <template v-else>
          <div><span>数据版本</span><strong>{{ preview.datasetVersion.replace(/^.*\//, '') }}</strong></div>
          <div><span>证据</span><strong>{{ integratedEvidenceCount(preview) }}</strong></div>
          <div><span>纳入范围</span><strong>{{ integratedCoverage(preview).includes.length }}</strong></div>
          <div><span>排除范围</span><strong>{{ integratedCoverage(preview).excludes.length }}</strong></div>
        </template>
      </div>

      <el-alert
        v-if="preview && isStudentPreview(preview)"
        :title="coverageTitle(preview)"
        :description="`不纳入：${preview.dataCoverage.excludes.join('、') || '无'}`"
        type="info"
        :closable="false"
      />
      <el-alert
        v-if="preview && isIntegratedPreview(preview)"
        :title="integratedCoverageTitle(preview)"
        :description="`明确排除：${integratedCoverage(preview).excludes.join('、') || '无'}`"
        type="info"
        :closable="false"
      />

      <div class="ai-summary-toolbar">
        <AiModelSelector v-model="selectedConfigId" :configurations="enabledConfigs" />
        <span class="muted">本次输出上限（可选）</span>
        <el-input-number v-model="requestedMaxTokens" :min="100" :max="8192" :step="100" placeholder="自动" style="width: 140px" />
        <el-button v-if="requestedMaxTokens !== undefined" link @click="requestedMaxTokens = undefined">恢复自动</el-button>
        <span class="muted">{{ outputLimitHint }}</span>
        <el-button type="primary" :loading="working" @click="generate">
          {{ lastTask?.status === 'failed' ? '再次生成（会调用模型）' : '生成/复用草稿' }}
        </el-button>
        <el-button :disabled="!active" :loading="working" @click="regenerate">重新生成</el-button>
        <span v-if="lastTask" class="muted">
          最近一次历史{{ lastTask.cacheHit ? '缓存命中' : '模型调用' }} · {{ usageLabel(lastTask) }}
          <template v-if="limitChanged(lastTask)"> · 当前设置 {{ effectiveOutputLimit === null ? '未显式限制' : `${effectiveOutputLimit} Token` }}</template>
          · 剩余 {{ quota(lastTask) }}
        </span>
      </div>
      <el-alert
        v-if="lastTask?.status === 'failed'"
        :title="`最近一次模型调用失败：${lastTask.sanitizedError || '未知错误'}`"
        :description="usageDescription(lastTask)"
        type="error"
        show-icon
        :closable="false"
      />

      <div class="ai-summary-workspace">
        <aside class="ai-summary-history">
          <div class="section-head"><h3>历史版本</h3><span class="muted">{{ history.length }}</span></div>
          <el-empty v-if="!history.length" description="尚未生成总结" :image-size="72" />
          <button
            v-for="item in history"
            v-else
            :key="item.id"
            type="button"
            class="ai-summary-history-item"
            :class="{ active: active?.id === item.id }"
            @click="selectSummary(item)"
          >
            <span>v{{ item.draftVersion }} · {{ formatDate(item.updatedAt) }}</span>
            <el-tag size="small" :type="statusType(item.reviewStatus)">{{ statusLabel(item.reviewStatus) }}</el-tag>
          </button>
        </aside>

        <section :key="active?.id || 'empty'" class="ai-summary-editor">
          <el-empty v-if="!active" description="选择模型生成第一个草稿" />
          <template v-else>
            <div class="section-head">
              <div><h3>总结草稿 · v{{ active.draftVersion }}</h3><span class="muted">编辑会使旧审核失效，并生成新的草稿版本。</span></div>
              <div class="toolbar">
                <el-button :disabled="!canEdit" :loading="working" @click="save">保存编辑</el-button>
                <template v-if="summaryKind !== 'lesson'">
                  <el-button type="warning" plain :disabled="!canReview" :loading="working" @click="review">审核通过</el-button>
                  <el-button type="success" :disabled="!canPublish" :loading="working" @click="publish">发布</el-button>
                  <el-button type="danger" plain :disabled="!canRevoke" :loading="working" @click="revoke">撤回</el-button>
                </template>
                <el-button v-else type="primary" :disabled="!canApply" @click="applyLessonDraft">应用到教学记录草稿</el-button>
              </div>
            </div>
            <el-form label-position="top" :disabled="!canEdit">
              <el-form-item label="核心结论"><el-input v-model="editor.headline" type="textarea" :rows="2" maxlength="500" /></el-form-item>
              <div class="ai-summary-editor-grid">
                <el-form-item label="整体概览（每行一条）"><el-input v-model="editor.overview" type="textarea" :rows="4" /></el-form-item>
                <el-form-item :label="`${['exam', 'class'].includes(summaryKind) ? '班级' : '学习'}优势（每行一条）`"><el-input v-model="editor.strengths" type="textarea" :rows="4" /></el-form-item>
                <el-form-item label="风险与薄弱项（每行一条）"><el-input v-model="editor.risks" type="textarea" :rows="4" /></el-form-item>
                <el-form-item :label="`${summaryKind === 'exam' ? '教学' : '学习/教学'}行动建议（每行一条）`"><el-input v-model="editor.actions" type="textarea" :rows="4" /></el-form-item>
              </div>
              <el-form-item label="需人工复核（每行一条）"><el-input v-model="editor.needsReview" type="textarea" :rows="3" /></el-form-item>
            </el-form>
          </template>
        </section>
      </div>

      <el-collapse v-if="active" class="ai-summary-evidence">
        <el-collapse-item :title="`证据索引（${active.evidence.length}）`" name="evidence">
          <el-table :data="active.evidence" max-height="260" size="small">
            <el-table-column prop="metric" label="指标" min-width="180" />
            <el-table-column prop="sourceType" label="来源" width="130" />
            <el-table-column label="值" width="120"><template #default="{ row }">{{ evidenceValue(row.value, row.unit) }}</template></el-table-column>
            <el-table-column prop="refId" label="EvidenceRef" min-width="320" show-overflow-tooltip />
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import type {
  AiSummaryTask,
  ExamSummaryDatasetPreview,
  IntegratedSummaryDatasetPreview,
  StudentSummaryDatasetPreview,
} from '../models';
import { useAiSummaryDialog, type AiSummaryKind } from '../composables/useAiSummaryDialog';
import AiModelSelector from './AiModelSelector.vue';

const props = defineProps<{ kind: AiSummaryKind }>();
const emit = defineEmits<{ applyLesson: [content: Record<string, unknown>] }>();
const state = useAiSummaryDialog(props.kind);
const {
  active, applySummaryScope, canApply, canEdit, canPublish, canReview, canRevoke, editor, effectiveOutputLimit, enabledConfigs,
  generate, history, lastTask, loading, open, outputLimitHint, preview, publish, regenerate,
  requestedMaxTokens, review, revoke, save, scope, scopeDateRange, selectSummary, selectedConfigId, subjectName, visible, working, kindLabel,
} = state;
const summaryKind = props.kind;

defineExpose({ open });

function isExamPreview(value: SummaryPreview): value is ExamSummaryDatasetPreview {
  return 'participation' in value;
}

function isStudentPreview(value: SummaryPreview): value is StudentSummaryDatasetPreview {
  return 'coverage' in value && 'wrongQuestions' in value;
}

function isIntegratedPreview(value: SummaryPreview): value is IntegratedSummaryDatasetPreview {
  return 'dataset' in value;
}

function coverageTitle(value: StudentSummaryDatasetPreview) {
  const range = value.dataCoverage.from || value.dataCoverage.to
    ? `${value.dataCoverage.from ? formatDate(value.dataCoverage.from) : '不限'} 至 ${value.dataCoverage.to ? formatDate(value.dataCoverage.to) : '不限'}`
    : '全部可访问考试时间';
  return `数据覆盖：${range}；纳入 ${value.dataCoverage.includes.join('、')}`;
}

function integratedCoverage(value: IntegratedSummaryDatasetPreview) {
  const dataset = value.dataset as Record<string, unknown>;
  return (dataset.dataCoverage ?? { includes: [], excludes: [] }) as { includes: string[]; excludes: string[] };
}

function integratedEvidenceCount(value: IntegratedSummaryDatasetPreview) {
  const dataset = value.dataset as Record<string, unknown>;
  return Array.isArray(dataset.evidence) ? dataset.evidence.length : 0;
}

function integratedCoverageTitle(value: IntegratedSummaryDatasetPreview) {
  return `确定性数据范围：纳入 ${integratedCoverage(value).includes.join('、') || '无'}`;
}

function applyLessonDraft() {
  if (active.value) emit('applyLesson', active.value.content as Record<string, unknown>);
}

type SummaryPreview = ExamSummaryDatasetPreview | StudentSummaryDatasetPreview | IntegratedSummaryDatasetPreview;

function statusLabel(value: string) {
  return ({ draft: '草稿', in_review: '待审核', approved: '已审核', published: '已发布', revoked: '已撤回' } as Record<string, string>)[value] ?? value;
}

function statusType(value: string) {
  return ({ approved: 'warning', published: 'success', revoked: 'danger' } as Record<string, 'warning' | 'success' | 'danger'>)[value] ?? 'info';
}

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString();
}

function evidenceValue(value: unknown, unit?: string | null) {
  return `${value ?? '-'}${unit ? ` ${unit}` : ''}`;
}

function quota(task: AiSummaryTask) {
  const value = task.usage.tokenQuota.remainingTokens;
  return value === null ? '本地预算不限' : `${value} Token`;
}

function usageLabel(task: AiSummaryTask) {
  const limit = task.usage.requestedOutputTokens === null
    ? '未显式设置供应商输出上限'
    : `请求上限 ${task.usage.requestedOutputTokens} Token`;
  if (task.usage.reported === false) return `${limit} / 用量未报告 / 估算预留 ${task.usage.reservedTokens} Token`;
  if (task.usage.reported === null) return `${limit} / 未发起或未记录模型用量`;
  return `${limit} / 输入 ${task.usage.inputTokens} / 输出 ${task.usage.outputTokens} Token`;
}

function usageDescription(task: AiSummaryTask) {
  if (task.usage.reported === false) {
    const currentLimit = effectiveOutputLimit.value === null ? '未显式限制' : `${effectiveOutputLimit.value} Token`;
    const current = limitChanged(task) ? ` 当前设置为${currentLimit}，历史预留不会被改写。` : '';
    const basis = task.usage.requestedOutputTokens === null
      ? '本次未向供应商发送输出上限；该估算上界仅用于本地记账，并未限制模型输出。'
      : `本次供应商请求上限为 ${task.usage.requestedOutputTokens} Token。`;
    return `供应商未返回准确 Token 用量，系统已估算预留 ${task.usage.reservedTokens} Token。${basis}${current}`;
  }
  return task.usage.reported === null ? '本次失败发生在模型用量形成之前，没有新增 Token 记录。' : '';
}

function limitChanged(task: AiSummaryTask) {
  return task.usage.requestedOutputTokens !== effectiveOutputLimit.value;
}
</script>

<style scoped>
:global(.ai-summary-modal) { max-height: 90vh; display: flex; flex-direction: column; margin-bottom: 0; }
:global(.ai-summary-modal .el-dialog__body) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.ai-summary-dialog { display: grid; gap: 16px; min-height: 520px; }
.ai-summary-scope { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 12px 18px; padding: 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-extra-light); }
.scope-field { display: grid; gap: 7px; }
.scope-label { color: var(--el-text-color-secondary); font-size: 12px; }
.scope-count-control { display: flex; align-items: center; gap: 4px; }
.ai-summary-metrics { display: grid; grid-template-columns: repeat(6, minmax(90px, 1fr)); gap: 10px; }
.ai-summary-metrics > div { padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-light); }
.ai-summary-metrics span { display: block; color: var(--el-text-color-secondary); font-size: 12px; }
.ai-summary-metrics strong { display: block; margin-top: 5px; font-size: 20px; }
.ai-summary-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.ai-summary-workspace { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; min-height: 420px; }
.ai-summary-history { min-height: 0; max-height: 420px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; border-right: 1px solid var(--el-border-color-lighter); padding-right: 12px; }
.ai-summary-history-item { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px; margin-bottom: 8px; border: 1px solid var(--el-border-color); border-radius: 7px; background: transparent; cursor: pointer; text-align: left; }
.ai-summary-history-item.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.ai-summary-editor { min-width: 0; }
.ai-summary-editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.ai-summary-evidence { border-top: 1px solid var(--el-border-color-lighter); }
@media (max-width: 900px) {
  .ai-summary-metrics { grid-template-columns: repeat(3, 1fr); }
  .ai-summary-workspace { grid-template-columns: 1fr; }
  .ai-summary-history { border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); }
  .ai-summary-editor-grid { grid-template-columns: 1fr; }
}
</style>
