/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- migrated page state is isolated here while domain models are typed incrementally.
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Edit, Link, Plus, Refresh } from '@element-plus/icons-vue';
import { getCurrentUser } from '../../../api';
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

export function useExternalAccountPage(): any {
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

return {
  Delete,
  Edit,
  ElMessage,
  ElMessageBox,
  Link,
  Plus,
  Refresh,
  accountForm,
  accounts,
  bindHydroAccount,
  bindMyHydroAccount,
  computed,
  createHydroPlatform,
  currentUser,
  deleteAccount,
  deletePlatform,
  dialogVisible,
  filters,
  getCurrentUser,
  handlePlatformChange,
  isSuperAdmin,
  listHydroAccounts,
  listHydroPlatforms,
  listMyHydroAccounts,
  listStudents,
  listTeachers,
  load,
  loadAccounts,
  loadMyAccounts,
  loadPlatforms,
  loading,
  myAccounts,
  onMounted,
  openCreateDialog,
  openCreateOwnDialog,
  openCreatePlatformDialog,
  openEditDialog,
  openEditPlatformDialog,
  openOj,
  ownerLabel,
  owners,
  pagination,
  platformDialogVisible,
  platformForm,
  platformSaving,
  platformStatusOptions,
  platforms,
  reactive,
  ref,
  removeHydroPlatform,
  removeManagedHydroAccount,
  removeOwnHydroAccount,
  router,
  saveAccount,
  savePlatform,
  saving,
  selectablePlatforms,
  statusOptions,
  students,
  teachers,
  testAccount,
  testManagedHydroAccount,
  testOwnHydroAccount,
  testingId,
  updateHydroPlatform,
  useRouter,
};
}
