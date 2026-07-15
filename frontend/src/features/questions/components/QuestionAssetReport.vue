<template>
  <div class="asset-maintenance">
    <div class="asset-maintenance-head">
      <div>
        <strong>资源维护</strong>
        <p class="mini-muted">扫描题目、试卷快照和作答实例中的附件引用。</p>
      </div>
      <el-button
        size="small"
        type="danger"
        plain
        :disabled="!report?.orphanCount"
        :loading="cleanupLoading"
        @click="emit('cleanup')"
      >
        清理孤立附件
      </el-button>
    </div>
    <div v-if="report" class="asset-stat-grid">
      <div><b>{{ report.total }}</b><span>总附件</span></div>
      <div><b>{{ report.referencedCount }}</b><span>已引用</span></div>
      <div><b>{{ report.orphanCount }}</b><span>孤立</span></div>
    </div>
    <div v-if="preview.length" class="asset-report-list">
      <div v-for="asset in preview" :key="asset.url" class="asset-report-item">
        <span class="asset-report-name">{{ asset.displayName || asset.filename }}</span>
        <el-tag size="small" :type="asset.referenced ? 'success' : 'warning'">
          {{ asset.referenced ? `${asset.referenceCount || 0} 处引用` : '孤立' }}
        </el-tag>
        <small>{{ assetKind(asset.kind) }} · {{ fileSize(asset.size) }}</small>
        <small v-if="asset.locations?.length" class="asset-reference-locations">
          {{ asset.locations.slice(0, 3).join('；') }}
        </small>
      </div>
    </div>
    <el-empty v-else-if="report" description="没有题目附件" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QuestionAssetReport } from '../models';

const props = defineProps<{ report: QuestionAssetReport | null; cleanupLoading: boolean }>();
const emit = defineEmits<{ cleanup: [] }>();
const preview = computed(() => (props.report?.items ?? []).slice(0, 10));

function assetKind(kind: string) {
  const labels: Record<string, string> = { image: '图片', pdf: 'PDF', word: '文档', sheet: '表格', archive: '压缩包', file: '文件' };
  return labels[kind] || '文件';
}

function fileSize(size: unknown) {
  const value = Number(size || 0);
  if (!value) return '未知大小';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
</script>

<style scoped>
.asset-maintenance { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--el-border-color-lighter); }
.asset-maintenance-head { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
.asset-maintenance-head p { margin: 4px 0 0; }
.asset-stat-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 12px 0; }
.asset-stat-grid > div { min-width: 0; padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-light); }
.asset-stat-grid b { display: block; color: var(--el-text-color-primary); font-size: 18px; line-height: 1.2; }
.asset-stat-grid span { display: block; margin-top: 4px; color: var(--el-text-color-secondary); font-size: 12px; }
.asset-report-list { display: grid; gap: 8px; }
.asset-report-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.asset-report-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-report-item small { grid-column: 1 / -1; color: var(--el-text-color-secondary); }
.asset-reference-locations { overflow-wrap: anywhere; }
</style>
