<template>
  <router-view v-if="isBareRoute" />
  <AppShell v-else />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const AppShell = defineAsyncComponent(() => import('./components/AppShell.vue'));
const isBareRoute = computed(() => route.path === '/login' || /^\/student\/exams\/[^/]+/.test(route.path));
</script>
