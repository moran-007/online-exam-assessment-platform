<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">个人信息</h1>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="panel profile-panel">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="姓名">{{ user?.realName || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="账号">{{ user?.username }}</el-descriptions-item>
        <el-descriptions-item label="身份">{{ roleName }}</el-descriptions-item>
        <el-descriptions-item label="用户 ID">{{ user?.id }}</el-descriptions-item>
        <el-descriptions-item label="角色">{{ user?.roles?.join('、') || '无' }}</el-descriptions-item>
        <el-descriptions-item label="权限数量">{{ user?.permissions?.length || 0 }}</el-descriptions-item>
      </el-descriptions>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { api, setSession } from '../api';

const user = ref(null);
const roleName = computed(() => {
  const names = {
    SUPER_ADMIN: '超级管理员',
    ADMIN: '管理员',
    TEACHER: '教师',
    ASSISTANT: '助教',
    STUDENT: '学生',
  };
  return names[user.value?.userType] ?? user.value?.userType ?? '';
});

async function load() {
  user.value = await api('/auth/me');
  setSession({ user: user.value });
}

onMounted(load);
</script>
