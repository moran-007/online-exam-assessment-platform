<template>
  <el-dialog v-model="visible" :title="`AI 考试总结 · ${examName}`" width="min(1120px, 94vw)" destroy-on-close>
    <div v-loading="loading" class="exam-ai-dialog">
      <el-alert
        title="统计预览始终来自确定性查询；AI 只生成草稿，必须人工审核后才能发布。"
        type="info"
        show-icon
        :closable="false"
      />

      <div v-if="preview" class="exam-ai-metrics">
        <div><span>提交</span><strong>{{ preview.participation.submitted.value }}</strong></div>
        <div><span>已评分</span><strong>{{ preview.participation.graded.value }}</strong></div>
        <div><span>平均分</span><strong>{{ preview.scores.average.value }}</strong></div>
        <div><span>中位数</span><strong>{{ preview.scores.median.value }}</strong></div>
        <div><span>题目</span><strong>{{ preview.questions.length }}</strong></div>
        <div><span>证据</span><strong>{{ preview.evidence.length }}</strong></div>
      </div>

      <div class="exam-ai-toolbar">
        <el-select v-model="selectedConfigId" clearable placeholder="自动选择默认模型" style="min-width: 280px">
          <el-option
            v-for="config in enabledConfigs"
            :key="config.id"
            :label="`${config.name} · ${config.model} · ${config.scope === 'personal' ? '个人' : '系统'}`"
            :value="config.id"
          />
        </el-select>
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
          <template v-if="limitChanged(lastTask)"> · 当前设置 {{ effectiveOutputLimit }} Token</template>
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

      <div class="exam-ai-workspace">
        <aside class="exam-ai-history">
          <div class="section-head"><h3>历史版本</h3><span class="muted">{{ history.length }}</span></div>
          <el-empty v-if="!history.length" description="尚未生成总结" :image-size="72" />
          <template v-else>
            <button
              v-for="item in history"
              :key="item.id"
              type="button"
              class="exam-ai-history-item"
              :class="{ active: active?.id === item.id }"
              @click="selectSummary(item)"
            >
              <span>v{{ item.draftVersion }} · {{ formatDate(item.updatedAt) }}</span>
              <el-tag size="small" :type="statusType(item.reviewStatus)">{{ statusLabel(item.reviewStatus) }}</el-tag>
            </button>
          </template>
        </aside>

        <section class="exam-ai-editor">
          <el-empty v-if="!active" description="选择模型生成第一个草稿" />
          <template v-else>
            <div class="section-head">
              <div>
                <h3>总结草稿</h3>
                <span class="muted">所有编辑都会使旧审核失效，并生成新的草稿版本。</span>
              </div>
              <div class="toolbar">
                <el-button :disabled="!canEdit" :loading="working" @click="save">保存编辑</el-button>
                <el-button type="warning" plain :disabled="!canReview" :loading="working" @click="review">审核通过</el-button>
                <el-button type="success" :disabled="!canPublish" :loading="working" @click="publish">发布</el-button>
                <el-button type="danger" plain :disabled="!canRevoke" :loading="working" @click="revoke">撤回</el-button>
              </div>
            </div>
            <el-form label-position="top" :disabled="!canEdit">
              <el-form-item label="核心结论"><el-input v-model="editor.headline" type="textarea" :rows="2" maxlength="500" /></el-form-item>
              <div class="exam-ai-editor-grid">
                <el-form-item label="整体概览（每行一条）"><el-input v-model="editor.overview" type="textarea" :rows="4" /></el-form-item>
                <el-form-item label="班级优势（每行一条）"><el-input v-model="editor.strengths" type="textarea" :rows="4" /></el-form-item>
                <el-form-item label="风险与薄弱项（每行一条）"><el-input v-model="editor.risks" type="textarea" :rows="4" /></el-form-item>
                <el-form-item label="教学行动建议（每行一条）"><el-input v-model="editor.actions" type="textarea" :rows="4" /></el-form-item>
              </div>
              <el-form-item label="需人工复核（每行一条）"><el-input v-model="editor.needsReview" type="textarea" :rows="3" /></el-form-item>
            </el-form>
          </template>
        </section>
      </div>

      <el-collapse v-if="active" class="exam-ai-evidence">
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
import type { ExamSummaryTask } from '../models';
import { useExamAiSummaryDialog } from '../composables/useExamAiSummaryDialog';

const state = useExamAiSummaryDialog();
const {
  active, canEdit, canPublish, canReview, canRevoke, editor, effectiveOutputLimit, enabledConfigs, examName,
  generate, history, lastTask, loading, open, outputLimitHint, preview, publish, regenerate, review, revoke,
  requestedMaxTokens, save, selectSummary, selectedConfigId, visible, working,
} = state;

defineExpose({ open });

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

function quota(task: ExamSummaryTask) {
  const value = task.usage.tokenQuota.remainingTokens;
  return value === null ? '本地预算不限' : `${value} Token`;
}

function usageLabel(task: ExamSummaryTask) {
  const limit = `请求上限 ${task.usage.requestedOutputTokens} Token`;
  if (task.usage.reported === false) return `${limit} / 用量未报告 / 已预留 ${task.usage.reservedTokens} Token`;
  if (task.usage.reported === null) return `${limit} / 未发起或未记录模型用量`;
  return `${limit} / 输入 ${task.usage.inputTokens} / 输出 ${task.usage.outputTokens} Token`;
}

function usageDescription(task: ExamSummaryTask) {
  if (task.usage.reported === false) {
    const current = limitChanged(task) ? ` 当前设置为 ${effectiveOutputLimit.value} Token，历史预留不会被改写。` : '';
    return `供应商未返回准确 Token 用量，系统已按该次历史请求上限保守预留 ${task.usage.reservedTokens} Token。${current}`;
  }
  return task.usage.reported === null ? '本次失败发生在模型用量形成之前，没有新增 Token 记录。' : '';
}

function limitChanged(task: ExamSummaryTask) {
  return effectiveOutputLimit.value !== null
    && task.usage.requestedOutputTokens !== effectiveOutputLimit.value;
}
</script>

<style scoped>
.exam-ai-dialog { display: grid; gap: 16px; min-height: 520px; }
.exam-ai-metrics { display: grid; grid-template-columns: repeat(6, minmax(90px, 1fr)); gap: 10px; }
.exam-ai-metrics > div { padding: 12px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-light); }
.exam-ai-metrics span { display: block; color: var(--el-text-color-secondary); font-size: 12px; }
.exam-ai-metrics strong { display: block; margin-top: 5px; font-size: 20px; }
.exam-ai-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.exam-ai-workspace { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 16px; min-height: 420px; }
.exam-ai-history { border-right: 1px solid var(--el-border-color-lighter); padding-right: 12px; }
.exam-ai-history-item { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px; margin-bottom: 8px; border: 1px solid var(--el-border-color); border-radius: 7px; background: transparent; cursor: pointer; text-align: left; }
.exam-ai-history-item.active { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.exam-ai-editor { min-width: 0; }
.exam-ai-editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.exam-ai-evidence { border-top: 1px solid var(--el-border-color-lighter); }
@media (max-width: 900px) {
  .exam-ai-metrics { grid-template-columns: repeat(3, 1fr); }
  .exam-ai-workspace { grid-template-columns: 1fr; }
  .exam-ai-history { border-right: 0; border-bottom: 1px solid var(--el-border-color-lighter); }
  .exam-ai-editor-grid { grid-template-columns: 1fr; }
}
</style>
