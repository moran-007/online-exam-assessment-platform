<template>
  <section v-if="canRead" v-loading="loading" class="panel ai-quality-panel">
    <div class="section-head">
      <div><h2>AI 质量、成本与回归</h2><span class="muted">最近 30 天，按功能、模型和 Prompt 版本追踪。</span></div>
      <el-button @click="load">刷新</el-button>
    </div>

    <div v-if="dashboard" class="quality-metrics">
      <Metric label="调用" :value="dashboard.totals.calls" />
      <Metric label="成功" :value="dashboard.totals.succeeded" />
      <Metric label="缓存命中率" :value="percent(dashboard.totals.cacheHitRate)" />
      <Metric label="平均评分" :value="dashboard.totals.averageRating.toFixed(2)" />
      <Metric label="错误反馈率" :value="percent(dashboard.totals.incorrectRate)" />
      <Metric label="输入 Token" :value="dashboard.totals.inputTokens" />
      <Metric label="输出 Token" :value="dashboard.totals.outputTokens" />
      <Metric label="估算成本" :value="dashboard.totals.estimatedCost.toFixed(6)" />
    </div>

    <el-tabs v-if="dashboard">
      <el-tab-pane label="质量明细">
        <el-table :data="dashboard.breakdown" max-height="340">
          <el-table-column prop="summaryType" label="功能" width="120" />
          <el-table-column prop="configName" label="配置" min-width="140" />
          <el-table-column prop="model" label="模型" min-width="150" />
          <el-table-column prop="promptVersion" label="Prompt" width="90" />
          <el-table-column prop="calls" label="调用" width="80" />
          <el-table-column label="成功率" width="90"><template #default="{ row }">{{ percent(row.successRate) }}</template></el-table-column>
          <el-table-column prop="published" label="发布" width="80" />
          <el-table-column prop="averageRating" label="评分" width="80" />
          <el-table-column prop="estimatedCost" label="成本" width="100" />
        </el-table>
      </el-tab-pane>
      <el-tab-pane :label="`用户反馈（${feedback.length}）`">
        <el-table :data="feedback" max-height="340">
          <el-table-column prop="summaryType" label="功能" width="110" />
          <el-table-column prop="reporterName" label="反馈人" width="120" />
          <el-table-column prop="rating" label="评分" width="70" />
          <el-table-column prop="verdict" label="结论" width="100" />
          <el-table-column prop="comment" label="说明" min-width="180" show-overflow-tooltip />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column v-if="canManage" label="处置" width="140" fixed="right">
            <template #default="{ row }">
              <template v-if="row.status === 'open'">
                <el-button link type="primary" @click="resolve(row, 'resolved')">解决</el-button>
                <el-button link @click="resolve(row, 'dismissed')">驳回</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
      <el-tab-pane label="模型切换回归">
        <div v-if="canManage" class="regression-toolbar">
          <el-select v-model="regressionForm.configId" placeholder="候选模型配置" style="width: 260px">
            <el-option v-for="item in configurations.filter((row) => row.enabled)" :key="item.id" :label="`${item.name} · ${item.model}`" :value="item.id" />
          </el-select>
          <el-select v-model="regressionForm.summaryType" style="width: 150px">
            <el-option v-for="item in summaryTypes" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-input-number v-model="regressionForm.caseCount" :min="1" :max="3" />
          <el-button type="primary" :loading="running" @click="runRegression">执行回归</el-button>
        </div>
        <el-table :data="regressions" max-height="300">
          <el-table-column prop="configName" label="配置" min-width="140" />
          <el-table-column prop="model" label="模型" min-width="140" />
          <el-table-column prop="summaryType" label="功能" width="110" />
          <el-table-column label="结果" width="110"><template #default="{ row }">{{ row.passedCases }}/{{ row.totalCases }}</template></el-table-column>
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="sanitizedError" label="错误" min-width="180" show-overflow-tooltip />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<script setup lang="ts">
import { toRef } from 'vue';
import type { AiProviderConfig } from '../models';
import Metric from './AiQualityMetric.vue';
import { useAiQualityPanel } from '../composables/useAiQualityPanel';

const props = defineProps<{ configurations: AiProviderConfig[] }>();
const { canManage, canRead, dashboard, feedback, load, loading, regressionForm, regressions, resolve, runRegression, running } =
  useAiQualityPanel(toRef(props, 'configurations'));
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const summaryTypes = [
  { label: '考试总结', value: 'exam' }, { label: '学生总结', value: 'student' },
  { label: '班级总结', value: 'class' }, { label: '家长报告', value: 'parent_report' },
  { label: '课堂助手', value: 'lesson' },
];
</script>

<style scoped>
.ai-quality-panel { flex: none; }
.quality-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 12px; }
.regression-toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
</style>
