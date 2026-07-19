<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="page-title">在线答题与智能测评平台</h1>
      <p class="muted" style="margin: 8px 0 20px 0">账号登录</p>
      <el-alert
        v-if="route.query.reason === 'expired'"
        title="登录已失效，请重新登录"
        type="warning"
        :closable="false"
        show-icon
        style="margin-bottom: 16px"
      />
      <el-form :model="form" label-position="top" @submit.prevent="login">
        <el-form-item label="账号">
          <el-input v-model="form.username" autocomplete="username" placeholder="请输入账号" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" autocomplete="current-password" show-password placeholder="请输入密码" />
        </el-form-item>
        <div class="login-options">
          <el-checkbox v-model="form.rememberMe">保持登录状态</el-checkbox>
          <span class="muted">勾选后默认最长 7 天</span>
        </div>
        <p class="login-hint muted">未勾选时仅当前浏览器会话有效；连续 30 分钟无操作会自动退出。</p>
        <el-button type="primary" :loading="loading" style="width: 100%" @click="login">
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { setSession } from '../api';
import { firstAccessiblePath } from '../access';
import { login as loginSession } from '../features/platform/api';

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const form = reactive({
  username: '',
  password: '',
  rememberMe: true,
});

async function login() {
  loading.value = true;
  try {
    const data = await loginSession({ ...form });
    setSession(data, { rememberMe: form.rememberMe });
    ElMessage.success('登录成功');
    router.replace(firstAccessiblePath(data.user));
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}
</script>
