<template>
  <el-config-provider :locale="zhCn">
    <el-container class="app-shell" :class="{ 'side-collapsed': sideCollapsed }">
    <el-aside :width="sideCollapsed ? '72px' : '216px'" class="side">
      <div class="brand">
        <div class="brand-mark">
          <el-icon><Reading /></el-icon>
          <div v-show="!sideCollapsed" class="brand-copy">
            <strong>智能测评</strong>
            <small>教学管理平台</small>
          </div>
        </div>
      </div>
      <el-menu :default-active="$route.path" router class="side-menu" :collapse="sideCollapsed" :collapse-transition="false">
        <div v-for="group in visibleMenuGroups" :key="group.id" class="menu-section" :data-testid="`menu-group-${group.id}`">
          <div v-if="!sideCollapsed" class="menu-section-label">{{ group.label }}</div>
          <div v-else class="menu-section-divider" aria-hidden="true" />
          <el-tooltip
            v-for="item in group.items"
            :key="item.path"
            :content="item.label"
            placement="right"
            :disabled="!sideCollapsed"
            :show-after="180"
          >
            <el-menu-item :index="item.path" :aria-label="item.label" :title="sideCollapsed ? item.label : undefined">
              <el-icon><component :is="menuIcon(item.icon)" /></el-icon>
              <span>{{ item.label }}</span>
            </el-menu-item>
          </el-tooltip>
        </div>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="topbar">
        <div class="topbar-context">
          <el-tooltip :content="sideCollapsed ? '展开导航栏' : '收起导航栏'" placement="bottom">
            <el-button
              class="side-toggle"
              text
              :icon="sideCollapsed ? Expand : Fold"
              :aria-label="sideCollapsed ? '展开导航栏' : '收起导航栏'"
              @click="toggleSide"
            />
          </el-tooltip>
          <span class="topbar-divider" aria-hidden="true" />
          <span class="route-copy">
            <strong>{{ currentMenuItem?.label || '智能测评' }}</strong>
            <small>{{ currentMenuGroup?.label || roleName }}</small>
          </span>
        </div>
        <div class="topbar-actions">
          <el-badge v-if="user" :value="notificationUnread" :hidden="!notificationUnread" :max="99">
            <el-button :icon="Bell" @click="openNotifications">通知</el-button>
          </el-badge>
          <div class="user-summary">
            <span class="user-avatar">{{ (user?.realName || user?.username || '访').slice(0, 1) }}</span>
            <span class="user-copy">
              <strong>{{ user?.realName || user?.username || '访客' }}</strong>
              <small>{{ roleName }}</small>
            </span>
          </div>
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
  </el-config-provider>
</template>

<script setup>
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  Bell,
  Calendar,
  Checked,
  Collection,
  DataBoard,
  Document,
  Download,
  EditPen,
  Expand,
  Fold,
  Link,
  Notebook,
  Postcard,
  PriceTag,
  Reading,
  Setting,
  Share,
  SwitchButton,
  Timer,
  TrendCharts,
  Upload,
  User,
  UserFilled,
} from '@element-plus/icons-vue';
import { menuGroupsForUser } from '../access';
import {
  clearSession,
  getCurrentUser,
  getRefreshToken,
  onSessionChange,
  startSessionActivityMonitor,
} from '../api';
import {
  getUnreadNotificationCount,
  listNotifications,
  logout as logoutSession,
  markAllNotificationsRead as markAllNotificationsReadRequest,
  markNotificationRead as markNotificationReadRequest,
} from '../features/platform/api';

const router = useRouter();
const route = useRoute();
const user = ref(getCurrentUser());
const notificationVisible = ref(false);
const notifications = ref([]);
const notificationUnread = ref(0);
const notificationsLoading = ref(false);
const sideCollapsed = ref(localStorage.getItem('smart-assessment-side-collapsed') === 'true');
const visibleMenuGroups = computed(() => menuGroupsForUser(user.value));
const currentMenuGroup = computed(() => visibleMenuGroups.value
  .find((group) => group.items.some((item) => item.path === route.path)));
const currentMenuItem = computed(() => currentMenuGroup.value?.items.find((item) => item.path === route.path));
const menuIcons = {
  Calendar,
  Checked,
  Collection,
  DataBoard,
  Document,
  Download,
  EditPen,
  Link,
  Notebook,
  Postcard,
  PriceTag,
  Reading,
  Setting,
  Share,
  Timer,
  TrendCharts,
  Upload,
  User,
  UserFilled,
};
const roleName = computed(() => {
  const names = {
    SUPER_ADMIN: '超级管理员',
    ADMIN: '管理员',
    TEACHER: '教师',
    ASSISTANT: '助教',
    STUDENT: '学生',
    PARENT: '家长',
  };
  return names[user.value?.userType] ?? user.value?.userType ?? '公开访问';
});

let unsubscribeSession = null;
let stopSessionActivityMonitor = null;

onMounted(() => {
  unsubscribeSession = onSessionChange((event) => {
    user.value = getCurrentUser();
    loadNotificationCount();
    if (event.detail?.reason === 'expired') {
      if (route.path !== '/login') {
        void router.replace({ path: '/login', query: { reason: 'expired' } });
      }
      ElMessage.warning('登录已失效，请重新登录');
    } else if (!user.value && event.detail?.reason === 'logout' && route.path !== '/login') {
      void router.replace('/login');
    }
  });
  stopSessionActivityMonitor = startSessionActivityMonitor();
  loadNotificationCount();
});

onUnmounted(() => {
  unsubscribeSession?.();
  stopSessionActivityMonitor?.();
});

async function logout() {
  const refreshToken = getRefreshToken();
  try {
    await logoutSession({ refreshToken });
  } catch {
    // 本地退出必须始终成功；服务端令牌会按闲置和最长时长策略失效。
  } finally {
    clearSession('logout');
    await router.replace('/login');
  }
}

function login() {
  router.push('/login');
}

function toggleSide() {
  sideCollapsed.value = !sideCollapsed.value;
  localStorage.setItem('smart-assessment-side-collapsed', String(sideCollapsed.value));
}

function menuIcon(name) {
  return menuIcons[name] || Document;
}

async function loadNotificationCount() {
  if (!user.value) {
    notificationUnread.value = 0;
    notifications.value = [];
    return;
  }
  try {
    const result = await getUnreadNotificationCount();
    notificationUnread.value = result.count || 0;
  } catch {
    notificationUnread.value = 0;
  }
}

async function openNotifications() {
  notificationVisible.value = true;
  notificationsLoading.value = true;
  try {
    const result = await listNotifications({ pageSize: 50 });
    notifications.value = result.items || [];
    notificationUnread.value = result.unreadCount || 0;
  } finally {
    notificationsLoading.value = false;
  }
}

async function markNotificationRead(item) {
  if (!item || item.readAt) return;
  const updated = await markNotificationReadRequest(item.id);
  item.readAt = updated.readAt;
  await loadNotificationCount();
}

async function markAllNotificationsRead() {
  await markAllNotificationsReadRequest();
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
