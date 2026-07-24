<template>
  <router-view v-if="isBareRoute" />
  <AppShell v-else />
  <AiChatAssistant v-if="aiChatAvailable" />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { hasAnyPermission } from './access';
import { getCurrentUser, onSessionChange } from './api';

const route = useRoute();
const AppShell = defineAsyncComponent(() => import('./components/AppShell.vue'));
const AiChatAssistant = defineAsyncComponent(() => import('./features/ai/components/AiChatAssistant.vue'));
const user = ref(getCurrentUser());
const isBareRoute = computed(() => route.path === '/login' || /^\/student\/exams\/[^/]+/.test(route.path));
const isActiveExamRoute = computed(() => /^\/student\/exams\/[^/]+$/.test(route.path));
const aiChatAvailable = computed(() => Boolean(user.value)
  && !isActiveExamRoute.value
  && hasAnyPermission(user.value, ['ai.chat.use']));
let unsubscribeSession: (() => void) | null = null;

onMounted(() => {
  unsubscribeSession = onSessionChange(() => { user.value = getCurrentUser(); });
});

onBeforeUnmount(() => unsubscribeSession?.());
</script>
