<template>
  <div class="table-footer statistics-table-footer">
    <span class="muted">共 {{ pagination.total }} {{ label }}</span>
    <el-pagination
      :current-page="pagination.page"
      :page-size="pagination.pageSize"
      background
      size="small"
      layout="sizes, prev, pager, next"
      :page-sizes="pageSizes"
      :total="pagination.total"
      @size-change="$emit('size-change', $event)"
      @current-change="$emit('page-change', $event)"
    />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  pagination: { page: number; pageSize: number; total: number };
  label: string;
  pageSizes?: number[];
}>(), {
  pageSizes: () => [5, 10, 20, 50],
});

defineEmits<{
  'page-change': [page: number];
  'size-change': [pageSize: number];
}>();
</script>
