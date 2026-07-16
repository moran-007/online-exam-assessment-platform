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
                <div class="user-main-cell"><strong>{{ row.realName || row.username }}</strong><small>{{ row.username }}</small></div>
              </template>
            </el-table-column>
            <el-table-column label="身份/职位" width="120">
              <template #default="{ row }"><el-tag>{{ userTypeLabel(row.userType) }}</el-tag></template>
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
                <div v-if="row.mustChangePassword && row.status === 'ACTIVE'" class="muted">首次改密</div>
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
              <template #default="{ row }"><div class="user-main-cell"><strong>{{ row.name }}</strong><small>{{ row.code }}</small></div></template>
            </el-table-column>
            <el-table-column prop="description" label="说明" min-width="240" show-overflow-tooltip />
            <el-table-column label="权限数" width="100">
              <template #default="{ row }">{{ row.permissionIds?.length || 0 }}</template>
            </el-table-column>
            <el-table-column label="用户数" width="100">
              <template #default="{ row }">{{ row.userCount || 0 }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }"><el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</el-tag></template>
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
        <el-form-item label="账号"><el-input v-model="userForm.username" :disabled="Boolean(editingUserId)" placeholder="登录账号" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="userForm.realName" placeholder="真实姓名" /></el-form-item>
        <el-form-item label="密码">
          <el-input v-model="userForm.password" type="password" show-password :placeholder="editingUserId ? '留空则不修改密码' : '留空默认 123456'" />
        </el-form-item>
        <el-form-item label="身份/职位">
          <el-select v-model="userForm.userType" style="width: 100%" @change="handleUserTypeChange">
            <el-option v-for="item in userTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色权限">
          <el-select v-model="userForm.roleIds" multiple filterable collapse-tags collapse-tags-tooltip style="width: 100%" placeholder="选择角色">
            <el-option
              v-for="role in roles"
              :key="role.id"
              :label="`${role.name}（${role.code}）`"
              :value="role.id"
              :disabled="role.status !== 'ACTIVE'"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态"><el-segmented v-model="userForm.status" :options="userStatusOptions" /></el-form-item>
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
        <el-form-item label="新密码"><el-input v-model="resetPasswordForm.password" type="password" show-password placeholder="至少 6 位" /></el-form-item>
        <el-form-item label="确认密码"><el-input v-model="resetPasswordForm.confirmPassword" type="password" show-password placeholder="再次输入新密码" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetPasswordDialogVisible = false">取消</el-button>
        <el-button type="primary" :icon="Key" :loading="savingResetPassword" @click="resetPassword">保存新密码</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleDialogVisible" :title="editingRoleId ? '编辑角色' : '新增角色'" width="560px" destroy-on-close>
      <el-form :model="roleForm" label-width="84px">
        <el-form-item label="名称"><el-input v-model="roleForm.name" placeholder="例如：教务管理员" /></el-form-item>
        <el-form-item label="编码"><el-input v-model="roleForm.code" placeholder="例如：academic_admin" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="roleForm.description" type="textarea" :rows="3" resize="vertical" /></el-form-item>
        <el-form-item label="状态"><el-segmented v-model="roleForm.status" :options="roleStatusOptions" /></el-form-item>
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
          <strong>{{ selectedRole?.name }}</strong><el-tag v-if="selectedRole">{{ selectedRole.code }}</el-tag>
        </div>
        <el-input v-model="permissionKeyword" clearable placeholder="筛选权限" />
        <div class="permission-tree-shell">
          <el-tree ref="permissionTreeRef" :data="filteredPermissionTree" node-key="id" show-checkbox default-expand-all :props="treeProps">
            <template #default="{ data }">
              <span v-if="data.group" class="permission-tree-group">{{ data.label }}</span>
              <span v-else class="permission-tree-label"><span>{{ data.name }}</span><small>{{ data.code }}</small></span>
            </template>
          </el-tree>
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
import { Edit, Key, Plus, Refresh, Search } from '@element-plus/icons-vue';
import { useUserManagementPage } from '../composables/useUserManagementPage';

const {
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
} = useUserManagementPage();
</script>

<style scoped>
.user-management-page { min-height: 0; }
.user-management-tabs { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.user-management-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; }
.user-management-tabs :deep(.el-tab-pane) { height: 100%; min-height: 0; }
.user-management-table-panel {
  height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 12px; overflow: hidden;
}
.user-management-table-panel .el-table { flex: 1; min-height: 260px; }
.user-management-toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.user-management-toolbar .el-input, .user-management-toolbar .el-select { width: 220px; max-width: 100%; }
.user-main-cell { display: grid; gap: 4px; min-width: 0; }
.user-main-cell strong, .user-main-cell small {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.user-main-cell small { color: var(--muted); font-size: 12px; }
.permission-drawer { height: 100%; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.permission-drawer-head { display: flex; gap: 8px; align-items: center; min-width: 0; }
.permission-tree-shell {
  flex: 1; min-height: 0; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px;
}
.permission-tree-label { display: inline-flex; align-items: baseline; gap: 8px; }
.permission-tree-label small { color: var(--muted); font-size: 11px; }
.permission-tree-group { font-weight: 600; }
.permission-drawer-footer { display: flex; justify-content: flex-end; gap: 10px; }
@media (max-width: 640px) {
  .user-management-toolbar .el-input, .user-management-toolbar .el-select { width: 100%; }
}
</style>
