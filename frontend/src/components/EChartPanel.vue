<template>
  <div ref="chartRef" class="echart-panel" :style="{ minHeight: resolvedHeight }" />
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

const props = defineProps({
  option: {
    type: Object,
    default: () => ({}),
  },
  height: {
    type: [String, Number],
    default: 220,
  },
});

const chartRef = ref(null);
let chart = null;
let resizeObserver = null;

const resolvedHeight = computed(() => (typeof props.height === 'number' ? `${props.height}px` : props.height));

function renderChart() {
  if (!chartRef.value) return;
  if (!chart) {
    chart = echarts.init(chartRef.value, null, { renderer: 'canvas' });
  }
  chart.setOption(props.option || {}, true);
  chart.resize();
}

onMounted(async () => {
  await nextTick();
  renderChart();
  resizeObserver = new ResizeObserver(() => chart?.resize());
  resizeObserver.observe(chartRef.value);
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
