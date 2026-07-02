<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="page-title">在线答题与智能测评平台</h1>
      <p class="muted" style="margin: 8px 0 20px 0">账号登录</p>
      <el-form :model="form" label-position="top" @submit.prevent="login">
        <el-form-item label="账号">
          <el-input v-model="form.username" placeholder="请输入账号" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" />
        </el-form-item>
        <el-button type="primary" :loading="loading" style="width: 100%" @click="login">
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api, setSession } from '../api';

const router = useRouter();
const loading = ref(false);
const form = reactive({
  username: '',
  password: '',
});

async function login() {
  loading.value = true;
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: form,
    });
    setSession(data);
    ElMessage.success('登录成功');
    router.push(data.user.userType === 'STUDENT' ? '/student/exams' : '/dashboard');
  } catch (error) {
    ElMessage.error(error.message);
  } finally {
    loading.value = false;
  }
}
</script>
