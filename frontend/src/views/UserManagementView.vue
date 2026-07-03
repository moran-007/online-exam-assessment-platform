<template>
  <div class="page user-management-page">
    <div class="page-head">
      <h1 class="page-title">用户权限</h1>
      <div class="toolbar">
        <el-button :icon="Refresh" @click="refreshAll">刷新</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreateUserDialog">新增用户</el-button>
      </div>
    </div>

    <el-tabs v-model="activeTab" class="user-management-tabs">
      <el-tab-pane label="用户" name="users">
        <section class="panel user-management-table-panel">
          <div class="user-management-toolbar">
            <el-input
              v-model="userFilters.keyword"
              clearable
              placeholder="账号 / 姓名 / 手机 / 邮箱"
              @keyup.enter="loadFirstUserPage"
              @clear="loadFirstUserPage"
            />
            <el-select v-model="userFilters.userType" clearable placeholder="身份/职位" @change="loadFirstUserPage">
              <el-option v-for="item in userTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-select v-model="userFilters.status" clearable placeholder="状态" @change="loadFirstUserPage">
              <el-option v-for="item in userStatusOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-button :icon="Search" @click="loadFirstUserPage">查询</el-button>
          </div>

          <el-table v-loading="userLoading" :data="users" height="100%">
            <el-table-column label="用户" min-width="220">
              <template #default="{ row }">
                <div class="user-main-cell">
                  <strong>{{ row.realName || row.username }}</strong>
                  <small>{{ row.username }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="身份/职位" width="120">
              <template #default="{ row }">
                <el-tag>{{ userTypeLabel(row.userType) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="角色权限" min-width="240">
              <template #default="{ row }">
                <div class="table-tag-list">
                  <el-tag v-for="role in row.roles" :key="role.id" type="info">{{ role.name }}</el-tag>
                  <span v-if="!row.roles?.length" class="muted">未分配角色</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="userStatusTag(row.status)">{{ userStatusLabel(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="lastLoginAt" label="最近登录" width="170">
              <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :icon="Edit" @click="openEditUserDialog(row)">编辑</el-button>
                <el-button link type="primary" :icon="Key" @click="openResetPasswordDialog(row)">密码</el-button>
              </template>
            </el-table-column>
          </el-table>

          <div class="table-footer">
            <span class="muted">共 {{ userPagination.total }} 个用户</span>
            <el-pagination
              v-model:current-page="userPagination.page"
              v-model:page-size="userPagination.pageSize"
              background
              size="small"
              :pager-count="5"
              layout="sizes, prev, pager, next"
              :page-sizes="pageSizes"
              :total="userPagination.total"
              @size-change="loadUsers"
              @current-change="loadUsers"
            />
          </div>
        </section>
      </el-tab-pane>

      <el-tab-pane label="角色权限" name="roles">
        <section class="panel user-management-table-panel">
          <div class="user-management-toolbar">
            <el-button type="primary" :icon="Plus" @click="openCreateRoleDialog">新增角色</el-button>
            <el-button :icon="Refresh" @click="loadRoles">刷新角色</el-button>
          </div>

          <el-table v-loading="roleLoading" :data="roles" height="100%">
            <el-table-column label="角色" min-width="220">
              <template #default="{ row }">
                <div class="user-main-cell">
                  <strong>{{ row.name }}</strong>
                  <small>{{ row.code }}</small>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="说明" min-width="240" show-overflow-tooltip />
            <el-table-column label="权限数" width="100">
              <template #default="{ row }">{{ row.permissionIds?.length || 0 }}</template>
            </el-table-column>
            <el-table-column label="用户数" width="100">
              <template #default="{ row }">{{ row.userCount || 0 }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">
                  {{ row.status === 'ACTIVE' ? '启用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" :icon="Edit" @click="openEditRoleDialog(row)">编辑</el-button>
                <el-button link type="primary" :icon="Key" @click="openPermissionDrawer(row)">权限</el-button>
              </template>
            </el-table-column>
          </el-table>
        </section>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="userDialogVisible" :title="editingUserId ? '编辑用户' : '新增用户'" width="620px" destroy-on-close>
      <el-form :model="userForm" label-width="96px">
        <el-form-item label="账号">
          <el-input v-model="userForm.username" :disabled="Boolean(editingUserId)" placeholder="登录账号" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="userForm.realName" placeholder="真实姓名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="userForm.password"
            type="password"
            show-password
            :placeholder="editingUserId ? '留空则不修改密码' : '留空默认 123456'"
          />
        </el-form-item>
        <el-form-item label="身份/职位">
          <el-select v-model="userForm.userType" style="width: 100%" @change="handleUserTypeChange">
            <el-option v-for="item in userTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色权限">
          <el-select
            v-model="userForm.roleIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            style="width: 100%"
            placeholder="选择角色"
          >
            <el-option
              v-for="role in roles"
              :key="role.id"
              :label="`${role.name}（${role.code}）`"
              :value="role.id"
              :disabled="role.status !== 'ACTIVE'"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-segmented v-model="userForm.status" :options="userStatusOptions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userDialogVisible = false">取消</el-button>
        <el-button type="primary" :icon="editingUserId ? Edit : Plus" :loading="savingUser" @click="saveUser">
          {{ editingUserId ? '保存用户' : '创建用户' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetPasswordDialogVisible" title="重置密码" width="460px" destroy-on-close>
      <el-form :model="resetPasswordForm" label-width="96px">
        <el-form-item label="用户">
          <el-input :model-value="resetPasswordUser ? `${resetPasswordUser.realName || resetPasswordUser.username}（${resetPasswordUser.username}）` : ''" disabled />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="resetPasswordForm.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="resetPasswordForm.confirmPassword" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPasswordDialogVisible = false">取消</el-button>
        <el-button type="primary" :icon="Key" :loading="savingResetPassword" @click="resetPassword">
          保存新密码
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialogVisible" :title="editingRoleId ? '编辑角色' : '新增角色'" width="560px" destroy-on-close>
      <el-form :model="roleForm" label-width="84px">
        <el-form-item label="名称">
          <el-input v-model="roleForm.name" placeholder="例如：教务管理员" />
        </el-form-item>
        <el-form-item label="编码">
          <el-input v-model="roleForm.code" placeholder="例如：academic_admin" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="roleForm.description" type="textarea" :rows="3" resize="vertical" />
        </el-form-item>
        <el-form-item label="状态">
          <el-segmented v-model="roleForm.status" :options="roleStatusOptions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleDialogVisible = false">取消</el-button>
        <el-button type="primary" :icon="editingRoleId ? Edit : Plus" :loading="savingRole" @click="saveRole">
          {{ editingRoleId ? '保存角色' : '创建角色' }}
        </el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="permissionDrawerVisible" title="权限分配" size="460px" destroy-on-close>
      <div class="permission-drawer">
        <div class="permission-drawer-head">
          <strong>{{ selectedRole?.name }}</strong>
          <el-tag v-if="selectedRole">{{ selectedRole.code }}</el-tag>
        </div>
        <el-input v-model="permissionKeyword" clearable placeholder="筛选权限" />
        <div class="permission-tree-shell">
          <el-tree
            ref="permissionTreeRef"
            :data="filteredPermissionTree"
            node-key="id"
            show-checkbox
            default-expand-all
            :props="treeProps"
          />
        </div>
        <div class="permission-drawer-footer">
          <el-button @click="permissionDrawerVisible = false">关闭</el-button>
          <el-button type="primary" :icon="Key" :loading="savingPermissions" @click="saveRolePermissions">保存权限</el-button>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Edit, Key, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';

const activeTab = ref('users');
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

const userFilters = reactive({
  keyword: '',
  userType: '',
  status: '',
});
const userPagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
});
const userForm = reactive(baseUserForm());
const roleForm = reactive(baseRoleForm());
const resetPasswordForm = reactive({
  password: '',
  confirmPassword: '',
});

const userTypeOptions = [
  { label: '超级管理员', value: 'SUPER_ADMIN' },
  { label: '管理员', value: 'ADMIN' },
  { label: '教师', value: 'TEACHER' },
  { label: '助教', value: 'ASSISTANT' },
  { label: '学生', value: 'STUDENT' },
  { label: '家长', value: 'PARENT' },
];
const userStatusOptions = [
  { label: '启用', value: 'ACTIVE' },
  { label: '停用', value: 'DISABLED' },
  { label: '锁定', value: 'LOCKED' },
];
const roleStatusOptions = [
  { label: '启用', value: 'ACTIVE' },
  { label: '停用', value: 'DISABLED' },
];
const permissionGroupNames = {
  course: '课程',
  'knowledge-point': '知识点',
  tag: '标签',
  question: '题库',
  paper: '试卷',
  exam: '考试',
  class: '班级',
  grading: '批改',
  statistics: '统计',
  'audit-log': '审计',
};

const activeRoles = computed(() => roles.value.filter((role) => role.status === 'ACTIVE'));
const validPermissionIds = computed(() => new Set(permissions.value.map((permission) => permission.id)));
const permissionTree = computed(() => {
  const groups = new Map();
  permissions.value.forEach((permission) => {
    const groupCode = permission.code.split(':')[0] || 'other';
    if (!groups.has(groupCode)) {
      groups.set(groupCode, {
        id: `group:${groupCode}`,
        label: permissionGroupNames[groupCode] || groupCode,
        children: [],
      });
    }
    groups.get(groupCode).children.push({
      id: permission.id,
      label: `${permission.name}（${permission.code}）`,
      code: permission.code,
      name: permission.name,
    });
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      children: group.children.sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});
const filteredPermissionTree = computed(() => {
  const keyword = permissionKeyword.value.trim().toLowerCase();
  if (!keyword) return permissionTree.value;

  return permissionTree.value
    .map((group) => {
      const children = group.children.filter(
        (item) => item.label.toLowerCase().includes(keyword) || item.code.toLowerCase().includes(keyword),
      );
      return children.length || group.label.toLowerCase().includes(keyword) ? { ...group, children } : null;
    })
    .filter(Boolean);
});

onMounted(refreshAll);

function baseUserForm() {
  return {
    username: '',
    realName: '',
    password: '',
    userType: 'TEACHER',
    roleIds: [],
    status: 'ACTIVE',
  };
}

function baseRoleForm() {
  return {
    name: '',
    code: '',
    description: '',
    status: 'ACTIVE',
  };
}

async function refreshAll() {
  await Promise.all([loadRoles(), loadPermissions(), loadUsers()]);
}

async function loadUsers() {
  userLoading.value = true;
  try {
    const result = await api(
      `/users${buildQuery({
        page: userPagination.page,
        pageSize: userPagination.pageSize,
        keyword: userFilters.keyword,
        userType: userFilters.userType,
        status: userFilters.status,
      })}`,
    );
    users.value = result.items || [];
    userPagination.page = result.page;
    userPagination.pageSize = result.pageSize;
    userPagination.total = result.total;
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
    roles.value = await api('/users/roles');
  } finally {
    roleLoading.value = false;
  }
}

async function loadPermissions() {
  permissions.value = await api('/users/permissions');
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
  resetPasswordForm.password = '';
  resetPasswordForm.confirmPassword = '';
  resetPasswordDialogVisible.value = true;
}

function handleUserTypeChange(value) {
  if (!editingUserId.value || !userForm.roleIds.length) {
    applyDefaultRole(value, true);
  }
}

function applyDefaultRole(userType, force = false) {
  if (!force && userForm.roleIds.length) return;
  const roleCodeMap = {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'teacher',
    TEACHER: 'teacher',
    ASSISTANT: 'teacher',
    STUDENT: 'student',
  };
  const roleCode = roleCodeMap[userType];
  const role = activeRoles.value.find((item) => item.code === roleCode);
  userForm.roleIds = role ? [role.id] : [];
}

async function saveUser() {
  if (!userForm.username.trim()) {
    ElMessage.warning('请填写账号');
    return;
  }
  if (!userForm.userType) {
    ElMessage.warning('请选择身份/职位');
    return;
  }

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
      await api(`/users/${editingUserId.value}`, { method: 'PATCH', body });
      ElMessage.success('用户已保存');
    } else {
      await api('/users', {
        method: 'POST',
        body: {
          ...body,
          username: userForm.username,
        },
      });
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
  if (resetPasswordForm.password.length < 6) {
    ElMessage.warning('新密码至少 6 位');
    return;
  }
  if (resetPasswordForm.password !== resetPasswordForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }

  savingResetPassword.value = true;
  try {
    await api(`/users/${resetPasswordUser.value.id}/reset-password`, {
      method: 'POST',
      body: { password: resetPasswordForm.password },
    });
    ElMessage.success('密码已重置');
    resetPasswordDialogVisible.value = false;
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
    name: row.name,
    code: row.code,
    description: row.description || '',
    status: row.status,
  });
  roleDialogVisible.value = true;
}

async function saveRole() {
  if (!roleForm.name.trim() || !roleForm.code.trim()) {
    ElMessage.warning('请填写角色名称和编码');
    return;
  }

  savingRole.value = true;
  try {
    const body = {
      name: roleForm.name,
      code: roleForm.code,
      description: roleForm.description || undefined,
      status: roleForm.status,
    };
    if (editingRoleId.value) {
      await api(`/users/roles/${editingRoleId.value}`, { method: 'PATCH', body });
      ElMessage.success('角色已保存');
    } else {
      await api('/users/roles', { method: 'POST', body });
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
  permissionKeyword.value = '';
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
    await api(`/users/roles/${selectedRole.value.id}/permissions`, {
      method: 'PUT',
      body: { permissionIds },
    });
    ElMessage.success('权限已保存');
    permissionDrawerVisible.value = false;
    await Promise.all([loadRoles(), loadUsers()]);
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    savingPermissions.value = false;
  }
}

function userTypeLabel(value) {
  return userTypeOptions.find((item) => item.value === value)?.label || value || '-';
}

function userStatusLabel(value) {
  return userStatusOptions.find((item) => item.value === value)?.label || value || '-';
}

function userStatusTag(value) {
  if (value === 'ACTIVE') return 'success';
  if (value === 'LOCKED') return 'warning';
  return 'info';
}

function formatDateTime(value) {
  return value ? new Date(value).toLocaleString() : '-';
}
</script>

<style scoped>
.user-management-page {
  min-height: 0;
}

.user-management-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.user-management-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}

.user-management-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.user-management-table-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
}

.user-management-table-panel .el-table {
  flex: 1;
  min-height: 260px;
}

.user-management-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.user-management-toolbar .el-input,
.user-management-toolbar .el-select {
  width: 220px;
  max-width: 100%;
}

.user-main-cell {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.user-main-cell strong,
.user-main-cell small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-main-cell small {
  color: var(--muted);
  font-size: 12px;
}

.permission-drawer {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}

.permission-drawer-head {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.permission-tree-shell {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}

.permission-drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 640px) {
  .user-management-toolbar .el-input,
  .user-management-toolbar .el-select {
    width: 100%;
  }
}
</style>
