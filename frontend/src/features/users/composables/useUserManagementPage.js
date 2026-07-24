import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRoute } from 'vue-router';
import {
  createRole,
  createUser,
  listPermissions,
  listRoles,
  listUsers,
  resetUserPassword,
  updateRole,
  updateRolePermissions,
  updateUser,
} from '../../platform/api';

const permissionGroupNames = {
  course: '课程', 'knowledge-point': '知识点', tag: '标签', question: '题库', paper: '试卷',
  exam: '考试', class: '班级', grading: '批改', student: '学生信息', export: '导出',
  attachment: '附件', hydro: '外部判题', statistics: '统计', 'audit-log': '审计',
  ai: 'AI 能力', 'lesson-plan': '教案', 'lesson-record': '教学记录', 'lesson-asset': '教学附件',
};

export const userTypeOptions = [
  { label: '超级管理员', value: 'SUPER_ADMIN' },
  { label: '管理员', value: 'ADMIN' },
  { label: '教师', value: 'TEACHER' },
  { label: '助教', value: 'ASSISTANT' },
  { label: '学生', value: 'STUDENT' },
  { label: '家长', value: 'PARENT' },
];

export const userStatusOptions = [
  { label: '待激活', value: 'PENDING_ACTIVATION' },
  { label: '启用', value: 'ACTIVE' },
  { label: '停用', value: 'DISABLED' },
  { label: '锁定', value: 'LOCKED' },
];

export function useUserManagementPage() {
  const route = useRoute();
  const activeTab = ref(route.query.section === 'roles' ? 'roles' : 'users');
  const users = ref([]);
  const roles = ref([]);
  const permissions = ref([]);
  const userLoading = ref(false);
  const roleLoading = ref(false);
  const savingUser = ref(false);
  const savingRole = ref(false);
  const savingPermissions = ref(false);
  const savingResetPassword = ref(false);
  const userDialogVisible = ref(false);
  const resetPasswordDialogVisible = ref(false);
  const roleDialogVisible = ref(false);
  const permissionDrawerVisible = ref(false);
  const editingUserId = ref('');
  const editingRoleId = ref('');
  const selectedRole = ref(null);
  const resetPasswordUser = ref(null);
  const permissionTreeRef = ref(null);
  const permissionKeyword = ref('');
  const pageSizes = [20, 50, 100];
  const treeProps = { label: 'label', children: 'children' };
  const roleStatusOptions = [
    { label: '启用', value: 'ACTIVE' },
    { label: '停用', value: 'DISABLED' },
  ];
  const userFilters = reactive({ keyword: '', userType: '', status: '' });
  const userPagination = reactive({ page: 1, pageSize: 20, total: 0 });
  const userForm = reactive(baseUserForm());
  const roleForm = reactive(baseRoleForm());
  const resetPasswordForm = reactive({ password: '', confirmPassword: '' });

  const activeRoles = computed(() => roles.value.filter((role) => role.status === 'ACTIVE' && role.assignable !== false));
  const validPermissionIds = computed(() => new Set(permissions.value.map((permission) => permission.id)));
  const permissionTree = computed(() => buildPermissionTree(permissions.value));
  const filteredPermissionTree = computed(() => filterPermissionTree(permissionTree.value, permissionKeyword.value));

  async function refreshAll() {
    await Promise.all([loadRoles(), loadPermissions(), loadUsers()]);
  }

  async function loadUsers() {
    userLoading.value = true;
    try {
      const result = await listUsers({
        page: userPagination.page,
        pageSize: userPagination.pageSize,
        keyword: userFilters.keyword || undefined,
        userType: userFilters.userType || undefined,
        status: userFilters.status || undefined,
      });
      users.value = result.items || [];
      Object.assign(userPagination, { page: result.page, pageSize: result.pageSize, total: result.total });
    } finally {
      userLoading.value = false;
    }
  }

  function loadFirstUserPage() {
    userPagination.page = 1;
    return loadUsers();
  }

  async function loadRoles() {
    roleLoading.value = true;
    try {
      roles.value = await listRoles();
    } finally {
      roleLoading.value = false;
    }
  }

  async function loadPermissions() {
    permissions.value = await listPermissions();
  }

  function openCreateUserDialog() {
    editingUserId.value = '';
    Object.assign(userForm, baseUserForm());
    applyDefaultRole('TEACHER', true);
    userDialogVisible.value = true;
  }

  function openEditUserDialog(row) {
    editingUserId.value = row.id;
    Object.assign(userForm, {
      username: row.username,
      realName: row.realName || '',
      password: '',
      userType: row.userType,
      roleIds: [...(row.roleIds || [])],
      status: row.status,
    });
    userDialogVisible.value = true;
  }

  function openResetPasswordDialog(row) {
    resetPasswordUser.value = row;
    Object.assign(resetPasswordForm, { password: '', confirmPassword: '' });
    resetPasswordDialogVisible.value = true;
  }

  function handleUserTypeChange(value) {
    if (!editingUserId.value || !userForm.roleIds.length) applyDefaultRole(value, true);
  }

  function applyDefaultRole(userType, force = false) {
    if (!force && userForm.roleIds.length) return;
    const roleCode = {
      SUPER_ADMIN: 'super_admin', ADMIN: 'teacher', TEACHER: 'teacher', ASSISTANT: 'teacher', STUDENT: 'student',
    }[userType];
    const role = activeRoles.value.find((item) => item.code === roleCode);
    userForm.roleIds = role ? [role.id] : [];
  }

  async function saveUser() {
    if (!userForm.username.trim()) return ElMessage.warning('请填写账号');
    if (!userForm.userType) return ElMessage.warning('请选择身份/职位');
    savingUser.value = true;
    try {
      const body = {
        realName: userForm.realName || undefined,
        password: userForm.password || undefined,
        userType: userForm.userType,
        status: userForm.status,
        roleIds: userForm.roleIds,
      };
      if (editingUserId.value) {
        await updateUser(editingUserId.value, body);
        ElMessage.success('用户已保存');
      } else {
        await createUser({ ...body, username: userForm.username });
        ElMessage.success('用户已创建');
      }
      userDialogVisible.value = false;
      await Promise.all([loadUsers(), loadRoles()]);
    } catch (error) {
      ElMessage.error(error.message || '保存失败');
    } finally {
      savingUser.value = false;
    }
  }

  async function resetPassword() {
    if (!resetPasswordUser.value) return;
    if (resetPasswordForm.password.length < 6) return ElMessage.warning('新密码至少 6 位');
    if (resetPasswordForm.password !== resetPasswordForm.confirmPassword) {
      return ElMessage.warning('两次输入的新密码不一致');
    }
    savingResetPassword.value = true;
    try {
      await resetUserPassword(resetPasswordUser.value.id, { password: resetPasswordForm.password });
      ElMessage.success('密码已重置，账号已激活并要求首次改密');
      resetPasswordDialogVisible.value = false;
      await loadUsers();
    } catch (error) {
      ElMessage.error(error.message || '重置失败');
    } finally {
      savingResetPassword.value = false;
    }
  }

  function openCreateRoleDialog() {
    editingRoleId.value = '';
    Object.assign(roleForm, baseRoleForm());
    roleDialogVisible.value = true;
  }

  function openEditRoleDialog(row) {
    editingRoleId.value = row.id;
    Object.assign(roleForm, {
      name: row.name, code: row.code, description: row.description || '', status: row.status,
    });
    roleDialogVisible.value = true;
  }

  async function saveRole() {
    if (!roleForm.name.trim() || !roleForm.code.trim()) return ElMessage.warning('请填写角色名称和编码');
    savingRole.value = true;
    try {
      const body = {
        name: roleForm.name,
        code: roleForm.code,
        description: roleForm.description || undefined,
        status: roleForm.status,
      };
      if (editingRoleId.value) {
        await updateRole(editingRoleId.value, body);
        ElMessage.success('角色已保存');
      } else {
        await createRole(body);
        ElMessage.success('角色已创建');
      }
      roleDialogVisible.value = false;
      await Promise.all([loadRoles(), loadUsers()]);
    } catch (error) {
      ElMessage.error(error.message || '保存失败');
    } finally {
      savingRole.value = false;
    }
  }

  async function openPermissionDrawer(row) {
    selectedRole.value = row;
    permissionKeyword.value = typeof route.query.permission === 'string' ? route.query.permission : '';
    permissionDrawerVisible.value = true;
    await nextTick();
    permissionTreeRef.value?.setCheckedKeys(row.permissionIds || []);
  }

  async function saveRolePermissions() {
    if (!selectedRole.value) return;
    const checkedKeys = permissionTreeRef.value?.getCheckedKeys(false) || [];
    const permissionIds = checkedKeys.filter((id) => validPermissionIds.value.has(id));
    savingPermissions.value = true;
    try {
      await updateRolePermissions(selectedRole.value.id, { permissionIds });
      ElMessage.success('权限已保存');
      permissionDrawerVisible.value = false;
      await Promise.all([loadRoles(), loadUsers()]);
    } catch (error) {
      ElMessage.error(error.message || '保存失败');
    } finally {
      savingPermissions.value = false;
    }
  }

  onMounted(refreshAll);

  return {
    activeTab, editingRoleId, editingUserId, filteredPermissionTree, formatDateTime,
    handleUserTypeChange, loadFirstUserPage, loadRoles, loadUsers, openCreateRoleDialog,
    openCreateUserDialog, openEditRoleDialog, openEditUserDialog, openPermissionDrawer,
    openResetPasswordDialog, pageSizes, permissionDrawerVisible, permissionKeyword,
    permissionTreeRef, refreshAll, resetPassword, resetPasswordDialogVisible, resetPasswordForm,
    resetPasswordUser, roleDialogVisible, roleForm, roleLoading, roles, roleStatusOptions,
    saveRole, saveRolePermissions, saveUser, savingPermissions, savingResetPassword, savingRole,
    savingUser, selectedRole, treeProps, userDialogVisible, userFilters, userForm, userLoading,
    userPagination, users, userStatusLabel, userStatusOptions, userStatusTag, userTypeLabel,
    userTypeOptions,
  };
}

function baseUserForm() {
  return { username: '', realName: '', password: '', userType: 'TEACHER', roleIds: [], status: 'ACTIVE' };
}

function baseRoleForm() {
  return { name: '', code: '', description: '', status: 'ACTIVE' };
}

function buildPermissionTree(permissions) {
  const groups = new Map();
  for (const permission of permissions) {
    const groupCode = permission.code.startsWith('ai.') ? 'ai' : (permission.code.split(':')[0] || 'other');
    if (!groups.has(groupCode)) {
      groups.set(groupCode, {
        id: `group:${groupCode}`, label: permissionGroupNames[groupCode] || groupCode, group: true, children: [],
      });
    }
    groups.get(groupCode).children.push({
      id: permission.id, label: permission.name, code: permission.code, name: permission.name,
      description: permission.description || '',
    });
  }
  return [...groups.values()].map((group) => ({
    ...group, children: group.children.sort((a, b) => a.code.localeCompare(b.code)),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

function filterPermissionTree(tree, value) {
  const keyword = value.trim().toLowerCase();
  if (!keyword) return tree;
  return tree.map((group) => {
    const children = group.children.filter(
      (item) => item.label.toLowerCase().includes(keyword) || item.code.toLowerCase().includes(keyword),
    );
    return children.length || group.label.toLowerCase().includes(keyword) ? { ...group, children } : null;
  }).filter(Boolean);
}

function optionLabel(options, value) {
  return options.find((item) => item.value === value)?.label || value || '-';
}

function userTypeLabel(value) {
  return optionLabel(userTypeOptions, value);
}

function userStatusLabel(value) {
  return optionLabel(userStatusOptions, value);
}

function userStatusTag(value) {
  if (value === 'ACTIVE') return 'success';
  if (value === 'PENDING_ACTIVATION') return 'warning';
  if (value === 'LOCKED') return 'warning';
  return 'info';
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}
