<template>
  <router-view v-if="isBareRoute" />
  <el-container v-else class="app-shell" :class="{ 'side-collapsed': sideCollapsed }">
    <el-aside :width="sideCollapsed ? '72px' : '224px'" class="side">
      <div class="brand">
        <div class="brand-mark">
          <el-icon><Reading /></el-icon>
          <span v-show="!sideCollapsed">智能测评</span>
        </div>
        <el-tooltip :content="sideCollapsed ? '展开侧边栏' : '收起侧边栏'" placement="right">
          <el-button class="side-toggle" text :icon="sideCollapsed ? Expand : Fold" @click="toggleSide" />
        </el-tooltip>
      </div>
      <el-menu :default-active="$route.path" router class="side-menu" :collapse="sideCollapsed" :collapse-transition="false">
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
        <div class="topbar-actions">
          <el-badge v-if="user" :value="notificationUnread" :hidden="!notificationUnread" :max="99">
            <el-button :icon="Bell" @click="openNotifications">通知</el-button>
          </el-badge>
          <el-button :icon="SwitchButton" @click="user ? logout() : login()">{{ user ? '退出' : '登录' }}</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
    <el-drawer v-model="notificationVisible" title="站内通知" size="420px" destroy-on-close>
      <div class="notification-head">
        <span class="muted">未读 {{ notificationUnread }} 条</span>
        <el-button size="small" :disabled="!notificationUnread" @click="markAllNotificationsRead">全部已读</el-button>
      </div>
      <el-empty v-if="!notifications.length && !notificationsLoading" description="暂无通知" />
      <div v-else class="notification-list">
        <div
          v-for="item in notifications"
          :key="item.id"
          class="notification-item"
          :class="{ unread: !item.readAt }"
          @click="markNotificationRead(item)"
        >
          <div class="notification-title">
            <strong>{{ item.title }}</strong>
            <el-tag v-if="!item.readAt" size="small" type="warning">未读</el-tag>
          </div>
          <p>{{ item.content || '无内容' }}</p>
          <span class="muted">{{ formatTime(item.createdAt) }}</span>
        </div>
      </div>
    </el-drawer>
  </el-container>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Bell, Expand, Fold, Reading, SwitchButton } from '@element-plus/icons-vue';
import { menuForUser } from './access';
import { api, clearSession, getCurrentUser, onSessionChange } from './api';

const router = useRouter();
const route = useRoute();
const user = ref(getCurrentUser());
const notificationVisible = ref(false);
const notifications = ref([]);
const notificationUnread = ref(0);
const notificationsLoading = ref(false);
const sideCollapsed = ref(localStorage.getItem('smart-assessment-side-collapsed') === 'true');
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
    loadNotificationCount();
  });
  loadNotificationCount();
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

function toggleSide() {
  sideCollapsed.value = !sideCollapsed.value;
  localStorage.setItem('smart-assessment-side-collapsed', String(sideCollapsed.value));
}

async function loadNotificationCount() {
  if (!user.value) {
    notificationUnread.value = 0;
    notifications.value = [];
    return;
  }
  try {
    const result = await api('/notifications/unread-count');
    notificationUnread.value = result.count || 0;
  } catch {
    notificationUnread.value = 0;
  }
}

async function openNotifications() {
  notificationVisible.value = true;
  notificationsLoading.value = true;
  try {
    const result = await api('/notifications?pageSize=50');
    notifications.value = result.items || [];
    notificationUnread.value = result.unreadCount || 0;
  } finally {
    notificationsLoading.value = false;
  }
}

async function markNotificationRead(item) {
  if (!item || item.readAt) return;
  const updated = await api(`/notifications/${item.id}/read`, { method: 'PATCH' });
  item.readAt = updated.readAt;
  await loadNotificationCount();
}

async function markAllNotificationsRead() {
  await api('/notifications/read-all', { method: 'POST' });
  notifications.value.forEach((item) => {
    item.readAt = item.readAt || new Date().toISOString();
  });
  await loadNotificationCount();
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}
</script>

<style scoped>
.topbar-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.notification-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.notification-list {
  display: grid;
  gap: 10px;
}

.notification-item {
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}

.notification-item.unread {
  border-color: #f3c56b;
  background: #fffbeb;
}

.notification-title {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.notification-item p {
  margin: 8px 0;
  color: #4b5563;
  overflow-wrap: anywhere;
}
</style>
