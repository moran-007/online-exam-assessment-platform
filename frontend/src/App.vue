<template>
  <router-view v-if="isBareRoute" />
  <el-container v-else class="app-shell">
    <el-aside width="224px" class="side">
      <div class="brand">
        <el-icon><Reading /></el-icon>
        <span>智能测评</span>
      </div>
      <el-menu :default-active="$route.path" router class="side-menu">
        <template v-if="!user">
          <el-menu-item index="/question-bank">
            <el-icon><EditPen /></el-icon><span>公开题库</span>
          </el-menu-item>
        </template>
        <template v-else-if="user?.userType === 'STUDENT'">
          <el-menu-item index="/question-bank">
            <el-icon><EditPen /></el-icon><span>题库</span>
          </el-menu-item>
          <el-menu-item index="/student/exams">
            <el-icon><Calendar /></el-icon><span>我的考试</span>
          </el-menu-item>
          <el-menu-item index="/student/wrong-questions">
            <el-icon><Notebook /></el-icon><span>错题本</span>
          </el-menu-item>
          <el-menu-item index="/student/profile">
            <el-icon><User /></el-icon><span>个人信息</span>
          </el-menu-item>
        </template>
        <template v-else>
          <el-menu-item index="/dashboard">
            <el-icon><DataBoard /></el-icon><span>看板</span>
          </el-menu-item>
          <el-menu-item index="/courses">
            <el-icon><Collection /></el-icon><span>课程</span>
          </el-menu-item>
          <el-menu-item index="/classes">
            <el-icon><UserFilled /></el-icon><span>班级</span>
          </el-menu-item>
          <el-menu-item index="/knowledge">
            <el-icon><Share /></el-icon><span>课程知识点</span>
          </el-menu-item>
          <el-menu-item index="/tags">
            <el-icon><PriceTag /></el-icon><span>标签</span>
          </el-menu-item>
          <el-menu-item index="/questions">
            <el-icon><EditPen /></el-icon><span>题库</span>
          </el-menu-item>
          <el-menu-item index="/question-import">
            <el-icon><Upload /></el-icon><span>题目导入</span>
          </el-menu-item>
          <el-menu-item index="/papers">
            <el-icon><Document /></el-icon><span>试卷</span>
          </el-menu-item>
          <el-menu-item index="/exams">
            <el-icon><Timer /></el-icon><span>考试</span>
          </el-menu-item>
          <el-menu-item index="/grading">
            <el-icon><Checked /></el-icon><span>批改</span>
          </el-menu-item>
          <el-menu-item index="/exports">
            <el-icon><Download /></el-icon><span>导出</span>
          </el-menu-item>
          <el-menu-item index="/statistics">
            <el-icon><TrendCharts /></el-icon><span>统计</span>
          </el-menu-item>
        </template>
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
import { SwitchButton, Upload } from '@element-plus/icons-vue';
import { clearSession, getCurrentUser, onSessionChange } from './api';

const router = useRouter();
const route = useRoute();
const user = ref(getCurrentUser());
const isBareRoute = computed(() => route.path === '/login' || /^\/student\/exams\/[^/]+/.test(route.path));
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
