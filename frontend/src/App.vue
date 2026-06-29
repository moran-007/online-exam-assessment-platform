<template>
  <router-view v-if="isBareRoute" />
  <el-container v-else class="app-shell">
    <el-aside width="224px" class="side">
      <div class="brand">
        <el-icon><Reading /></el-icon>
        <span>智能测评</span>
      </div>
      <el-menu :default-active="$route.path" router class="side-menu">
        <el-menu-item v-for="item in visibleMenuItems" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="topbar">
        <div>
          <strong>{{ user?.realName || user?.username || '访客' }}</strong>
          <span class="muted">{{ roleName }}</span>
        </div>
        <el-button :icon="SwitchButton" @click="user ? logout() : login()">{{ user ? '退出' : '登录' }}</el-button>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { SwitchButton } from '@element-plus/icons-vue';
import { menuForUser } from './access';
import { clearSession, getCurrentUser, onSessionChange } from './api';

const router = useRouter();
const route = useRoute();
const user = ref(getCurrentUser());
const isBareRoute = computed(() => route.path === '/login' || /^\/student\/exams\/[^/]+/.test(route.path));
const visibleMenuItems = computed(() => menuForUser(user.value));
const roleName = computed(() => {
  const names = {
    SUPER_ADMIN: '超级管理员',
    ADMIN: '管理员',
    TEACHER: '教师',
    ASSISTANT: '助教',
    STUDENT: '学生',
  };
  return names[user.value?.userType] ?? user.value?.userType ?? '公开访问';
});

let unsubscribeSession = null;

onMounted(() => {
  unsubscribeSession = onSessionChange(() => {
    user.value = getCurrentUser();
  });
});

onUnmounted(() => {
  unsubscribeSession?.();
});

function logout() {
  clearSession();
  router.push('/login');
}

function login() {
  router.push('/login');
}
</script>
