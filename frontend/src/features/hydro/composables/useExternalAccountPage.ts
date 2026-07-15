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
import type { HydroAccountView, HydroPlatform, HydroUserOption } from '../models';

type AccountForm = {
  id: string;
  studentId: string;
  platformCode: string;
  platformName: string;
  platformBaseUrl: string;
  loginUsername: string;
  loginPassword: string;
  hydroUsername: string;
  hydroUserId: string;
  bindStatus: 'bound' | 'disabled';
};

type PlatformForm = {
  id: string;
  code: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  sortOrder: number;
};

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('记录格式无效');
  return value as Record<string, unknown>;
}

function hydroAccountFrom(value: unknown) {
  const account = recordValue(value);
  if (typeof account.id !== 'string') throw new Error('外部账号格式无效');
  return account as HydroAccountView;
}

function platformFrom(value: unknown) {
  const platform = recordValue(value);
  if (typeof platform.id !== 'string' || typeof platform.code !== 'string' || typeof platform.name !== 'string') {
    throw new Error('接入平台格式无效');
  }
  return platform as HydroPlatform;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useExternalAccountPage() {
const currentUser = getCurrentUser() as HydroUserOption | null;
const router = useRouter();
const isSuperAdmin = currentUser?.userType === 'SUPER_ADMIN';
const platforms = ref<HydroPlatform[]>([]);
const students = ref<HydroUserOption[]>([]);
const teachers = ref<HydroUserOption[]>([]);
const accounts = ref<HydroAccountView[]>([]);
const myAccounts = ref<HydroAccountView[]>([]);
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
const accountForm = reactive<AccountForm>({
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
const platformForm = reactive<PlatformForm>({
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
  const map = new Map<string, HydroUserOption>();
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

function openEditDialog(value: unknown) {
  const row = hydroAccountFrom(value);
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
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, '保存失败'));
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

function openEditPlatformDialog(value: unknown) {
  const row = platformFrom(value);
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
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, '保存失败'));
  } finally {
    platformSaving.value = false;
  }
}

async function deletePlatform(value: unknown) {
  const row = platformFrom(value);
  try {
    await ElMessageBox.confirm(`确认删除接入平台「${row.name}」吗？已保存的账号绑定不会被清空。`, '删除接入平台', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await removeHydroPlatform(row.id);
    await loadPlatforms();
    ElMessage.success('接入平台已删除');
  } catch (error: unknown) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(errorMessage(error, '删除失败'));
    }
  }
}

async function testAccount(value: unknown) {
  const row = hydroAccountFrom(value);
  testingId.value = row.id;
  try {
    const result = await (isSuperAdmin ? testManagedHydroAccount(row.id) : testOwnHydroAccount(row.id));
    await Promise.all([loadAccounts(), loadMyAccounts()]);
    const messageType = result.status === 'blocked' ? 'error' : result.success ? 'success' : 'warning';
    ElMessage[messageType](result.message || '检测完成');
  } catch (error: unknown) {
    ElMessage.error(errorMessage(error, '检测失败'));
  } finally {
    testingId.value = '';
  }
}

async function deleteAccount(value: unknown) {
  const row = hydroAccountFrom(value);
  try {
    await ElMessageBox.confirm(`确认删除「${row.ownerName || row.studentName}」的外部账号绑定吗？`, '删除外部账号', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await (isSuperAdmin ? removeManagedHydroAccount(row.id) : removeOwnHydroAccount(row.id));
    await Promise.all([loadAccounts(), loadMyAccounts()]);
    ElMessage.success('外部账号已删除');
  } catch (error: unknown) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(errorMessage(error, '删除失败'));
    }
  }
}

function handlePlatformChange(code: string) {
  const platform = selectablePlatforms.value.find((item) => item.code === code);
  if (platform) {
    accountForm.platformBaseUrl = platform.baseUrl;
    accountForm.platformName = platform.name;
  }
}

function openOj(value: unknown) {
  const row = hydroAccountFrom(value);
  window.open(row.platformBaseUrl || 'https://oj.example.com', '_blank', 'noopener,noreferrer');
}

function ownerLabel(user?: HydroUserOption | null) {
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
