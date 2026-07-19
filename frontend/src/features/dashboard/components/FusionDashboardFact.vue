<template>
  <div class="fact"><span>{{ label }}</span><strong>{{ value }}</strong></div>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: string | number }>();
</script>

<style scoped>
.fact { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: #f8fafc; }
.fact span { color: #4b5563; }
.fact strong { font-size: 20px; }
</style>
