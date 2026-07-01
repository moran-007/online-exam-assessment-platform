<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">外部账号</h1>
        <span class="muted">管理用户在 Hydro 等 OJ 平台的登录账号</span>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreateDialog">新增账号</el-button>
      </div>
    </div>

    <div class="panel filter-panel">
      <el-form inline>
        <el-form-item label="关键字">
          <el-input v-model="filters.keyword" clearable placeholder="用户 / Hydro / 站点" @keyup.enter="loadAccounts" />
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="filters.platformCode" clearable style="width: 180px">
            <el-option v-for="platform in platforms" :key="platform.code" :label="platform.name" :value="platform.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="站点">
          <el-input v-model="filters.platformBaseUrl" clearable placeholder="http://moran007.top" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadAccounts">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel">
      <el-table :data="accounts" v-loading="loading">
        <el-table-column label="用户" min-width="170">
          <template #default="{ row }">
            <strong>{{ row.ownerName || row.studentName }}</strong>
            <div class="muted">{{ row.ownerUsername || row.username }}</div>
          </template>
        </el-table-column>
        <el-table-column label="平台" min-width="110">
          <template #default="{ row }">{{ row.platformName || row.platformCode }}</template>
        </el-table-column>
        <el-table-column prop="platformBaseUrl" label="站点" min-width="190" />
        <el-table-column prop="loginUsername" label="登录账号" min-width="140" />
        <el-table-column label="Hydro账号" min-width="160">
          <template #default="{ row }">
            <span>{{ row.hydroUsername }}</span>
            <div class="muted">{{ row.hydroUserId }}</div>
          </template>
        </el-table-column>
        <el-table-column label="密码" width="95">
          <template #default="{ row }">
            <el-tag :type="row.hasPassword ? 'success' : 'warning'">{{ row.hasPassword ? '已保存' : '未保存' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" min-width="160">
          <template #default="{ row }">
            <el-tag :type="row.lastLoginStatus === 'success' ? 'success' : row.lastLoginStatus ? 'warning' : 'info'">
              {{ row.lastLoginStatus === 'success' ? '登录正常' : row.lastLoginMessage || '未检测' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="primary" :loading="testingId === row.id" @click="testAccount(row)">检测</el-button>
            <el-button link :icon="Link" @click="openOj(row)">打开</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-row">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          layout="total, sizes, prev, pager, next"
          :total="pagination.total"
          @current-change="loadAccounts"
          @size-change="loadAccounts"
        />
      </div>
    </div>

    <el-dialog v-model="dialogVisible" :title="accountForm.id ? '编辑外部账号' : '新增外部账号'" width="560px">
      <el-form label-width="112px">
        <el-form-item label="所属用户">
          <el-select v-model="accountForm.studentId" filterable style="width: 100%">
            <el-option
              v-for="owner in owners"
              :key="owner.id"
              :label="`${owner.realName || owner.username}（${owner.username}）`"
              :value="owner.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="接入平台">
          <el-select v-model="accountForm.platformCode" style="width: 100%" @change="handlePlatformChange">
            <el-option
              v-for="platform in platforms"
              :key="platform.code"
              :label="`${platform.name}（${platform.baseUrl}）`"
              :value="platform.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="OJ站点">
          <el-input v-model="accountForm.platformBaseUrl" placeholder="http://moran007.top" />
        </el-form-item>
        <el-form-item label="登录账号">
          <el-input v-model="accountForm.loginUsername" placeholder="Hydro 登录账号" />
        </el-form-item>
        <el-form-item label="登录密码">
          <el-input v-model="accountForm.loginPassword" type="password" show-password placeholder="留空保持原密码" />
        </el-form-item>
        <el-form-item label="Hydro用户名">
          <el-input v-model="accountForm.hydroUsername" />
        </el-form-item>
        <el-form-item label="Hydro UID">
          <el-input v-model="accountForm.hydroUserId" placeholder="不知道时可与用户名相同" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-segmented v-model="accountForm.bindStatus" :options="statusOptions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveAccount">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Link, Refresh } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';

const platforms = ref([]);
const students = ref([]);
const teachers = ref([]);
const accounts = ref([]);
const loading = ref(false);
const saving = ref(false);
const testingId = ref('');
const dialogVisible = ref(false);
const filters = reactive({
  keyword: '',
  platformCode: '',
  platformBaseUrl: '',
});
const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
});
const accountForm = reactive({
  id: '',
  studentId: '',
  platformCode: 'hydro',
  platformBaseUrl: 'http://moran007.top',
  loginUsername: '',
  loginPassword: '',
  hydroUsername: '',
  hydroUserId: '',
  bindStatus: 'bound',
});
const statusOptions = [
  { label: '启用', value: 'bound' },
  { label: '停用', value: 'disabled' },
];
const owners = computed(() => {
  const map = new Map();
  [...students.value, ...teachers.value].forEach((user) => map.set(user.id, user));
  return [...map.values()].sort((a, b) => String(a.realName || a.username).localeCompare(String(b.realName || b.username)));
});

async function load() {
  loading.value = true;
  try {
    const [platformResult, studentResult, teacherResult] = await Promise.all([
      api('/hydro/platforms'),
      api('/users/students'),
      api('/users/teachers'),
    ]);
    platforms.value = platformResult;
    students.value = studentResult;
    teachers.value = teacherResult;
    await loadAccounts();
  } finally {
    loading.value = false;
  }
}

async function loadAccounts() {
  loading.value = true;
  try {
    const result = await api(
      `/hydro/accounts${buildQuery({
        page: pagination.page,
        pageSize: pagination.pageSize,
        keyword: filters.keyword,
        platformCode: filters.platformCode,
        platformBaseUrl: filters.platformBaseUrl,
      })}`,
    );
    accounts.value = result.items;
    pagination.total = result.total;
  } finally {
    loading.value = false;
  }
}

function openCreateDialog() {
  Object.assign(accountForm, {
    id: '',
    studentId: owners.value[0]?.id || '',
    platformCode: platforms.value[0]?.code || 'hydro',
    platformBaseUrl: platforms.value[0]?.baseUrl || 'http://moran007.top',
    loginUsername: '',
    loginPassword: '',
    hydroUsername: '',
    hydroUserId: '',
    bindStatus: 'bound',
  });
  dialogVisible.value = true;
}

function openEditDialog(row) {
  Object.assign(accountForm, {
    id: row.id,
    studentId: row.studentId || row.ownerId,
    platformCode: row.platformCode || 'hydro',
    platformBaseUrl: row.platformBaseUrl || 'http://moran007.top',
    loginUsername: row.loginUsername || '',
    loginPassword: '',
    hydroUsername: row.hydroUsername || '',
    hydroUserId: row.hydroUserId || row.hydroUsername || '',
    bindStatus: row.bindStatus || 'bound',
  });
  dialogVisible.value = true;
}

async function saveAccount() {
  if (!accountForm.studentId || !accountForm.loginUsername.trim() || !accountForm.hydroUsername.trim()) {
    ElMessage.warning('请补全所属用户、登录账号和 Hydro 用户名');
    return;
  }
  if (!accountForm.id && !accountForm.loginPassword.trim()) {
    ElMessage.warning('新增账号需要填写登录密码');
    return;
  }
  saving.value = true;
  try {
    await api(`/hydro/accounts/${accountForm.studentId}`, {
      method: 'PUT',
      body: {
        id: accountForm.id || undefined,
        platformCode: accountForm.platformCode,
        platformBaseUrl: accountForm.platformBaseUrl,
        loginUsername: accountForm.loginUsername.trim(),
        loginPassword: accountForm.loginPassword.trim() || undefined,
        hydroUsername: accountForm.hydroUsername.trim(),
        hydroUserId: accountForm.hydroUserId.trim() || accountForm.hydroUsername.trim(),
        bindStatus: accountForm.bindStatus,
      },
    });
    dialogVisible.value = false;
    await loadAccounts();
    ElMessage.success('外部账号已保存');
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function testAccount(row) {
  testingId.value = row.id;
  try {
    const result = await api(`/hydro/accounts/${row.id}/test`, { method: 'POST' });
    await loadAccounts();
    ElMessage[result.success ? 'success' : 'warning'](result.message || '检测完成');
  } catch (error) {
    ElMessage.error(error.message || '检测失败');
  } finally {
    testingId.value = '';
  }
}

function handlePlatformChange(code) {
  const platform = platforms.value.find((item) => item.code === code);
  if (platform) accountForm.platformBaseUrl = platform.baseUrl;
}

function openOj(row) {
  window.open(row.platformBaseUrl || 'http://moran007.top', '_blank', 'noopener,noreferrer');
}

onMounted(load);
</script>
