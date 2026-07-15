<template>
  <div ref="chartRef" class="echart-panel" :style="{ minHeight: resolvedHeight }" />
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ECharts, EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const props = withDefaults(defineProps<{
  option?: EChartsCoreOption;
  height?: string | number;
}>(), {
  option: () => ({}),
  height: 220,
});

const chartRef = ref<HTMLElement | null>(null);
let chart: ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

const resolvedHeight = computed(() => (typeof props.height === 'number' ? `${props.height}px` : props.height));

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) {
    chart = echarts.init(chartRef.value, null, { renderer: 'canvas' });
  }
  chart.setOption(props.option, true);
  chart.resize();
}

onMounted(async () => {
  await nextTick();
  renderChart();
  resizeObserver = new ResizeObserver(() => chart?.resize());
  if (chartRef.value) resizeObserver.observe(chartRef.value);
});

watch(
  () => props.option,
  async () => {
    await nextTick();
    renderChart();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  chart?.dispose();
  resizeObserver = null;
  chart = null;
});
</script>

<style scoped>
.echart-panel {
  width: 100%;
  height: 100%;
  min-width: 0;
}
</style>
