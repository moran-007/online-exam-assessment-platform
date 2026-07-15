import { computed, type Ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import type {
  ClassPerformance,
  KnowledgeTrendPoint,
  QuestionDiagnostic,
  ScoreDistribution,
} from '../models';

type StatisticsChartState = {
  scoreDistribution: Ref<ScoreDistribution>;
  classComparison: Ref<ClassPerformance[]>;
  knowledgeTrend: Ref<KnowledgeTrendPoint[]>;
  questionDiagnostics: Ref<QuestionDiagnostic[]>;
};

export function useStatisticsCharts(state: StatisticsChartState) {
  const scoreDistributionOption = computed(() => {
    const buckets = state.scoreDistribution.value.buckets || [];
    return baseChartOption({
      tooltip: { trigger: 'axis' },
      grid: chartGrid(),
      xAxis: { type: 'category', data: buckets.map((item) => item.label), axisLabel: { interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{
        name: '提交次数',
        type: 'bar',
        data: buckets.map((item) => item.count),
        barMaxWidth: 34,
        itemStyle: { color: '#409eff', borderRadius: [5, 5, 0, 0] },
      }],
    });
  });

  const classComparisonOption = computed(() => {
    const rows = state.classComparison.value || [];
    return baseChartOption({
      tooltip: {
        trigger: 'axis',
        valueFormatter: (value: unknown) => (Number(value) <= 1 ? `${Math.round(Number(value) * 100)}%` : String(value ?? '')),
      },
      legend: { top: 0, right: 0, data: ['均分', '通过率', '完成率'] },
      grid: chartGrid(30),
      xAxis: { type: 'category', data: rows.map((item) => shortLabel(item.className)), axisLabel: { interval: 0, rotate: rows.length > 4 ? 18 : 0 } },
      yAxis: [
        { type: 'value', name: '分数', splitLine: { lineStyle: { color: '#eef2f7' } } },
        { type: 'value', name: '比例', min: 0, max: 1, axisLabel: { formatter: (value: number) => `${Math.round(value * 100)}%` } },
      ],
      series: [
        { name: '均分', type: 'bar', data: rows.map((item) => Number(item.averageScore || 0)), barMaxWidth: 28, itemStyle: { color: '#409eff', borderRadius: [4, 4, 0, 0] } },
        { name: '通过率', type: 'line', yAxisIndex: 1, data: rows.map((item) => Number(item.passRate || 0)), smooth: true, symbolSize: 6, itemStyle: { color: '#67c23a' } },
        { name: '完成率', type: 'line', yAxisIndex: 1, data: rows.map((item) => Number(item.completionRate || 0)), smooth: true, symbolSize: 6, itemStyle: { color: '#e6a23c' } },
      ],
    });
  });

  const knowledgeTrendOption = computed(() => {
    const rows = state.knowledgeTrend.value || [];
    const dates = [...new Set(rows.map((item) => item.date))].sort();
    const names = topKnowledgeTrendNames(rows, 6);
    return baseChartOption({
      tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => `${Math.round(Number(value || 0) * 100)}%` },
      legend: { top: 0, type: 'scroll', data: names },
      grid: chartGrid(36),
      xAxis: { type: 'category', data: dates },
      yAxis: { type: 'value', min: 0, max: 1, axisLabel: { formatter: (value: number) => `${Math.round(value * 100)}%` } },
      series: names.map((name) => ({
        name,
        type: 'line',
        smooth: true,
        connectNulls: true,
        data: dates.map((date) => rows.find((item) => item.date === date && item.name === name)?.correctRate ?? null),
      })),
    });
  });

  const questionDiagnosticsOption = computed(() => {
    const rows = state.questionDiagnostics.value || [];
    return baseChartOption({
      tooltip: {
        formatter(params: unknown) {
          const row = diagnosticFromChartValue(recordValue(params).data);
          return [
            row.title || '题目',
            `正确率：${percent(row.correctRate)}`,
            `区分度：${formatNumber(row.discrimination)}`,
            `难度偏差：${signed(row.difficultyDelta)}`,
            `异常：${row.anomalyCount || 0}`,
          ].join('<br>');
        },
      },
      grid: chartGrid(),
      xAxis: { type: 'value', name: '区分度', min: -1, max: 1 },
      yAxis: { type: 'value', name: '正确率', min: 0, max: 1, axisLabel: { formatter: (value: number) => `${Math.round(value * 100)}%` } },
      series: [{
        type: 'scatter',
        symbolSize: (value: unknown) => {
          const values = Array.isArray(value) ? value : [];
          return Math.min(30, Math.max(9, 9 + Number(values[2] || 0) * 2 + Math.abs(Number(values[3] || 0)) * 9));
        },
        data: rows.map((row) => [
          Number(row.discrimination || 0),
          Number(row.correctRate || 0),
          Number(row.anomalyCount || 0),
          Number(row.difficultyDelta || 0),
          row,
        ]),
        itemStyle: {
          color(params: unknown) {
            const row = diagnosticFromChartValue(recordValue(params).data);
            if (Number(row.anomalyCount || 0) > 0) return '#f56c6c';
            if (Number(row.discrimination || 0) < 0.2) return '#e6a23c';
            return '#67c23a';
          },
        },
      }],
    });
  });

  return { scoreDistributionOption, classComparisonOption, knowledgeTrendOption, questionDiagnosticsOption };
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function diagnosticFromChartValue(value: unknown): Partial<QuestionDiagnostic> {
  if (!Array.isArray(value) || !value[4] || typeof value[4] !== 'object') return {};
  return value[4] as Partial<QuestionDiagnostic>;
}

function baseChartOption(option: EChartsCoreOption): EChartsCoreOption {
  return { animationDuration: 350, textStyle: { color: '#334155', fontFamily: 'inherit' }, ...option };
}

function chartGrid(top = 18) {
  return { top, left: 36, right: 20, bottom: 32, containLabel: true };
}

function shortLabel(value: unknown) {
  const text = String(value || '-');
  return text.length > 10 ? `${text.slice(0, 10)}...` : text;
}

function topKnowledgeTrendNames(rows: KnowledgeTrendPoint[], limit: number) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) || 0) + Number(row.answerCount || 0));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name);
}

function percent(value: unknown) { return `${Math.round(Number(value || 0) * 100)}%`; }
function formatNumber(value: unknown) { return Number(value || 0).toFixed(2); }
function signed(value: unknown) {
  const number = Number(value || 0);
  return number > 0 ? `+${number.toFixed(2)}` : number.toFixed(2);
}
