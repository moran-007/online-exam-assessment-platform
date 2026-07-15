<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1 class="page-title">外部账号</h1>
        <span class="muted">{{ isSuperAdmin ? '管理用户在 Hydro 等 OJ 平台的登录账号' : '管理自己在 Hydro 等 OJ 平台的登录账号' }}</span>
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
            <el-option v-for="platform in selectablePlatforms" :key="platform.code" :label="platform.name" :value="platform.code" />
          </el-select>
        </el-form-item>
        <el-form-item label="站点">
          <el-input v-model="filters.platformBaseUrl" clearable placeholder="https://oj.example.com" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadAccounts">查询</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div class="panel">
      <div class="paper-preview-head">
        <div>
          <h2>我的账号</h2>
          <span class="muted">当前登录账号用于拉取外部题目和教师测试提交的 OJ 账号</span>
        </div>
        <div class="toolbar">
          <el-button @click="router.push('/profile')">个人中心维护</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreateOwnDialog">新增我的账号</el-button>
        </div>
      </div>
      <el-table :data="myAccounts" size="small">
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
        <el-table-column label="状态" min-width="150">
          <template #default="{ row }">
            <HydroLoginStatusTag :account="row" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="primary" :loading="testingId === row.id" @click="testAccount(row)">检测</el-button>
            <el-button link :icon="Link" @click="openOj(row)">打开</el-button>
            <el-button link type="danger" :icon="Delete" @click="deleteAccount(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-if="isSuperAdmin" class="panel external-platform-panel">
      <div class="paper-preview-head">
        <div>
          <h2>接入平台</h2>
          <span class="muted">配置外部账号表单中的平台下拉选项</span>
        </div>
        <el-button type="primary" :icon="Plus" @click="openCreatePlatformDialog">新增平台</el-button>
      </div>
      <el-table :data="platforms" size="small">
        <el-table-column prop="name" label="平台名称" min-width="140" />
        <el-table-column prop="code" label="编码" width="120" />
        <el-table-column prop="baseUrl" label="站点" min-width="220" />
        <el-table-column prop="sortOrder" label="排序" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled === false ? 'info' : 'success'">{{ row.enabled === false ? '停用' : '启用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" :icon="Edit" @click="openEditPlatformDialog(row)">编辑</el-button>
            <el-button link type="danger" :icon="Delete" @click="deletePlatform(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel">
      <el-table v-loading="loading" :data="accounts">
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
            <HydroLoginStatusTag :account="row" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEditDialog(row)">编辑</el-button>
            <el-button link type="primary" :loading="testingId === row.id" @click="testAccount(row)">检测</el-button>
            <el-button link :icon="Link" @click="openOj(row)">打开</el-button>
            <el-button link type="danger" :icon="Delete" @click="deleteAccount(row)">删除</el-button>
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
        <el-form-item v-if="isSuperAdmin" label="所属用户">
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
              v-for="platform in selectablePlatforms"
              :key="platform.code"
              :label="`${platform.name}（${platform.baseUrl}）`"
              :value="platform.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="!isSuperAdmin" label="所属用户">
          <el-input :model-value="ownerLabel(currentUser)" disabled />
        </el-form-item>
        <el-form-item label="平台名称">
          <el-input v-model="accountForm.platformName" placeholder="例如：Tarjan OJ / 校内 Hydro" />
        </el-form-item>
        <el-form-item label="OJ站点">
          <el-input v-model="accountForm.platformBaseUrl" placeholder="https://oj.example.com" />
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

    <el-dialog v-model="platformDialogVisible" :title="platformForm.id ? '编辑接入平台' : '新增接入平台'" width="520px">
      <el-form label-width="96px">
        <el-form-item label="平台名称">
          <el-input v-model="platformForm.name" placeholder="例如：Hydro / Tarjan OJ" />
        </el-form-item>
        <el-form-item label="平台编码">
          <el-input v-model="platformForm.code" placeholder="例如：hydro" />
        </el-form-item>
        <el-form-item label="OJ站点">
          <el-input v-model="platformForm.baseUrl" placeholder="https://oj.example.com" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="platformForm.sortOrder" :min="0" :step="1" />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-segmented v-model="platformForm.enabled" :options="platformStatusOptions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="platformDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="platformSaving" @click="savePlatform">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Edit, Link, Plus, Refresh } from '@element-plus/icons-vue';
import { getCurrentUser } from '../../../api';
import HydroLoginStatusTag from './HydroLoginStatusTag.vue';
import {
  bindHydroAccount,
  bindMyHydroAccount,
  createHydroPlatform,
  listHydroAccounts,
  listHydroPlatforms,
  listMyHydroAccounts,
  listStudents,
  listTeachers,
  removeHydroPlatform,
  removeManagedHydroAccount,
  removeOwnHydroAccount,
  testManagedHydroAccount,
  testOwnHydroAccount,
  updateHydroPlatform,
} from '../api';

const currentUser = getCurrentUser();
const router = useRouter();
const isSuperAdmin = currentUser?.userType === 'SUPER_ADMIN';
const platforms = ref([]);
const students = ref([]);
const teachers = ref([]);
const accounts = ref([]);
const myAccounts = ref([]);
const loading = ref(false);
const saving = ref(false);
const platformSaving = ref(false);
const testingId = ref('');
const dialogVisible = ref(false);
const platformDialogVisible = ref(false);
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
  platformName: 'Hydro',
  platformBaseUrl: 'https://oj.example.com',
  loginUsername: '',
  loginPassword: '',
  hydroUsername: '',
  hydroUserId: '',
  bindStatus: 'bound',
});
const platformForm = reactive({
  id: '',
  code: '',
  name: '',
  baseUrl: '',
  enabled: true,
  sortOrder: 0,
});
const statusOptions = [
  { label: '启用', value: 'bound' },
  { label: '停用', value: 'disabled' },
];
const platformStatusOptions = [
  { label: '启用', value: true },
  { label: '停用', value: false },
];
const selectablePlatforms = computed(() => platforms.value.filter((platform) => platform.enabled !== false));
const owners = computed(() => {
  if (!isSuperAdmin) {
    return currentUser ? [currentUser] : [];
  }
  const map = new Map();
  if (currentUser) map.set(currentUser.id, currentUser);
  [...students.value, ...teachers.value].forEach((user) =>
    map.set(user.id, user),
  );
  return [...map.values()].sort((a, b) => String(a.realName || a.username).localeCompare(String(b.realName || b.username)));
});

async function load() {
  loading.value = true;
  try {
    await loadPlatforms();
    if (isSuperAdmin) {
      const [studentResult, teacherResult] = await Promise.all([listStudents(), listTeachers()]);
      students.value = studentResult;
      teachers.value = teacherResult;
    } else {
      students.value = [];
      teachers.value = [];
    }
    await Promise.all([loadAccounts(), loadMyAccounts()]);
  } finally {
    loading.value = false;
  }
}

async function loadPlatforms() {
  platforms.value = await listHydroPlatforms(isSuperAdmin);
}

async function loadAccounts() {
  loading.value = true;
  try {
    const result = await listHydroAccounts({
      page: pagination.page,
      pageSize: pagination.pageSize,
      keyword: filters.keyword || undefined,
      platformCode: filters.platformCode || undefined,
      platformBaseUrl: filters.platformBaseUrl || undefined,
    });
    accounts.value = result.items;
    pagination.total = result.total;
  } finally {
    loading.value = false;
  }
}

async function loadMyAccounts() {
  myAccounts.value = await listMyHydroAccounts();
}

function openCreateDialog() {
  const platform = selectablePlatforms.value[0];
  Object.assign(accountForm, {
    id: '',
    studentId: owners.value[0]?.id || currentUser?.id || '',
    platformCode: platform?.code || 'hydro',
    platformName: platform?.name || 'Hydro',
    platformBaseUrl: platform?.baseUrl || 'https://oj.example.com',
    loginUsername: '',
    loginPassword: '',
    hydroUsername: '',
    hydroUserId: '',
    bindStatus: 'bound',
  });
  dialogVisible.value = true;
}

function openCreateOwnDialog() {
  openCreateDialog();
  accountForm.studentId = currentUser?.id || '';
  accountForm.loginUsername = currentUser?.username || '';
  accountForm.hydroUsername = currentUser?.username || '';
  accountForm.hydroUserId = currentUser?.username || '';
}

function openEditDialog(row) {
  Object.assign(accountForm, {
    id: row.id,
    studentId: row.studentId || row.ownerId,
    platformCode: row.platformCode || 'hydro',
    platformName: row.platformName || '',
    platformBaseUrl: row.platformBaseUrl || 'https://oj.example.com',
    loginUsername: row.loginUsername || '',
    loginPassword: '',
    hydroUsername: row.hydroUsername || '',
    hydroUserId: row.hydroUserId || row.hydroUsername || '',
    bindStatus: row.bindStatus || 'bound',
  });
  dialogVisible.value = true;
}

async function saveAccount() {
  if (!isSuperAdmin) {
    accountForm.studentId = currentUser?.id || '';
  }
  if (!accountForm.studentId || !accountForm.platformCode || !accountForm.platformBaseUrl.trim() || !accountForm.loginUsername.trim() || !accountForm.hydroUsername.trim()) {
    ElMessage.warning('请补全所属用户、接入平台、登录账号和 Hydro 用户名');
    return;
  }
  if (!accountForm.id && !accountForm.loginPassword.trim()) {
    ElMessage.warning('新增账号需要填写登录密码');
    return;
  }
  saving.value = true;
  try {
    const payload = {
        id: accountForm.id || undefined,
        platformCode: accountForm.platformCode,
        platformName: accountForm.platformName.trim() || undefined,
        platformBaseUrl: accountForm.platformBaseUrl,
        loginUsername: accountForm.loginUsername.trim(),
        loginPassword: accountForm.loginPassword.trim() || undefined,
        hydroUsername: accountForm.hydroUsername.trim(),
        hydroUserId: accountForm.hydroUserId.trim() || accountForm.hydroUsername.trim(),
        bindStatus: accountForm.bindStatus,
      };
    await (isSuperAdmin
      ? bindHydroAccount(accountForm.studentId, payload)
      : bindMyHydroAccount(payload));
    dialogVisible.value = false;
    await Promise.all([loadAccounts(), loadMyAccounts()]);
    ElMessage.success('外部账号已保存');
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function openCreatePlatformDialog() {
  Object.assign(platformForm, {
    id: '',
    code: '',
    name: '',
    baseUrl: '',
    enabled: true,
    sortOrder: platforms.value.length + 1,
  });
  platformDialogVisible.value = true;
}

function openEditPlatformDialog(row) {
  Object.assign(platformForm, {
    id: row.id,
    code: row.code,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: row.enabled !== false,
    sortOrder: row.sortOrder || 0,
  });
  platformDialogVisible.value = true;
}

async function savePlatform() {
  if (!platformForm.name.trim() || !platformForm.code.trim() || !platformForm.baseUrl.trim()) {
    ElMessage.warning('请填写平台名称、编码和站点');
    return;
  }
  platformSaving.value = true;
  try {
    const payload = {
        code: platformForm.code.trim(),
        name: platformForm.name.trim(),
        baseUrl: platformForm.baseUrl.trim(),
        enabled: platformForm.enabled,
        sortOrder: platformForm.sortOrder,
      };
    await (platformForm.id
      ? updateHydroPlatform(platformForm.id, payload)
      : createHydroPlatform(payload));
    platformDialogVisible.value = false;
    await loadPlatforms();
    ElMessage.success('接入平台已保存');
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    platformSaving.value = false;
  }
}

async function deletePlatform(row) {
  try {
    await ElMessageBox.confirm(`确认删除接入平台「${row.name}」吗？已保存的账号绑定不会被清空。`, '删除接入平台', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await removeHydroPlatform(row.id);
    await loadPlatforms();
    ElMessage.success('接入平台已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

async function testAccount(row) {
  testingId.value = row.id;
  try {
    const result = await (isSuperAdmin ? testManagedHydroAccount(row.id) : testOwnHydroAccount(row.id));
    await Promise.all([loadAccounts(), loadMyAccounts()]);
    const messageType = result.status === 'blocked' ? 'error' : result.success ? 'success' : 'warning';
    ElMessage[messageType](result.message || '检测完成');
  } catch (error) {
    ElMessage.error(error.message || '检测失败');
  } finally {
    testingId.value = '';
  }
}

async function deleteAccount(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.ownerName || row.studentName}」的外部账号绑定吗？`, '删除外部账号', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await (isSuperAdmin ? removeManagedHydroAccount(row.id) : removeOwnHydroAccount(row.id));
    await Promise.all([loadAccounts(), loadMyAccounts()]);
    ElMessage.success('外部账号已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

function handlePlatformChange(code) {
  const platform = selectablePlatforms.value.find((item) => item.code === code);
  if (platform) {
    accountForm.platformBaseUrl = platform.baseUrl;
    accountForm.platformName = platform.name;
  }
}

function openOj(row) {
  window.open(row.platformBaseUrl || 'https://oj.example.com', '_blank', 'noopener,noreferrer');
}

function ownerLabel(user) {
  if (!user) return '';
  return `${user.realName || user.username}（${user.username}）`;
}

onMounted(load);
</script>

<style scoped>
.status-tag {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  white-space: nowrap;
}
</style>
