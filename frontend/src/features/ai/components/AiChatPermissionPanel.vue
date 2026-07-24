<template>
  <div class="ai-chat-permission-panel">
    <div class="permission-head">
      <div>
        <h2>AI 问答入口权限</h2>
        <p class="muted">分别控制问答入口、通用知识范围和是否允许直接给出答案；新建角色也可在这里分配。</p>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Setting" @click="openRolePermissions">完整角色权限</el-button>
      </div>
    </div>

    <el-alert
      title="权限统一由角色管理"
      type="info"
      :closable="false"
      description="ai.chat.use 控制入口；ai.chat.general-knowledge 控制能否回答平台题库之外的通用知识；ai.answer.direct 控制最终答案。正式考试作答页始终不显示问答入口。"
      show-icon
    />

    <div class="permission-table-shell">
      <el-table v-loading="loading" :data="roles" height="100%">
        <el-table-column label="角色" min-width="220">
          <template #default="{ row }">
            <div class="role-cell"><strong>{{ row.name }}</strong><small>{{ row.code }}</small></div>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="260" show-overflow-tooltip />
        <el-table-column label="用户数" width="100">
          <template #default="{ row }">{{ row.userCount || 0 }}</template>
        </el-table-column>
        <el-table-column label="角色状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="问答权限" width="210" fixed="right">
          <template #default="{ row }">
            <div class="permission-switch-cell">
              <template v-if="row.code === 'super_admin'">
                <el-switch :model-value="true" disabled />
                <span class="muted">系统保留</span>
              </template>
              <template v-else>
                <el-switch
                  :model-value="hasChatPermission(row)"
                  :loading="savingRoleId === row.id"
                  :disabled="row.status !== 'ACTIVE' || !chatPermissionId"
                  active-text="允许"
                  inactive-text="禁止"
                  @change="(enabled) => updatePermission(row, CHAT_PERMISSION_CODE, Boolean(enabled), 'AI 问答')"
                />
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="直接答案" width="210" fixed="right">
          <template #default="{ row }">
            <div class="permission-switch-cell">
              <template v-if="row.code === 'super_admin'">
                <el-switch :model-value="true" disabled />
                <span class="muted">系统保留</span>
              </template>
              <template v-else>
                <el-switch
                  :model-value="hasAnswerPermission(row)"
                  :loading="savingRoleId === row.id"
                  :disabled="row.status !== 'ACTIVE' || !answerPermissionId"
                  active-text="允许"
                  inactive-text="仅思路"
                  @change="(enabled) => updatePermission(row, ANSWER_PERMISSION_CODE, Boolean(enabled), '直接答案')"
                />
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="通用知识" width="210" fixed="right">
          <template #default="{ row }">
            <div class="permission-switch-cell">
              <template v-if="row.code === 'super_admin'">
                <el-switch :model-value="true" disabled />
                <span class="muted">系统保留</span>
              </template>
              <template v-else>
                <el-switch
                  :model-value="hasGeneralKnowledgePermission(row)"
                  :loading="savingRoleId === row.id"
                  :disabled="row.status !== 'ACTIVE' || !generalKnowledgePermissionId"
                  active-text="允许"
                  inactive-text="仅平台"
                  @change="(enabled) => updatePermission(row, GENERAL_KNOWLEDGE_PERMISSION_CODE, Boolean(enabled), '通用知识')"
                />
              </template>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh, Setting } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import { listPermissions, listRoles, updateRolePermissions, type PlatformRecord } from '../../platform/api';

const CHAT_PERMISSION_CODE = 'ai.chat.use';
const ANSWER_PERMISSION_CODE = 'ai.answer.direct';
const GENERAL_KNOWLEDGE_PERMISSION_CODE = 'ai.chat.general-knowledge';
const router = useRouter();
const roles = ref<PlatformRecord[]>([]);
const permissions = ref<PlatformRecord[]>([]);
const loading = ref(false);
const savingRoleId = ref('');
const chatPermissionId = computed(() => permissions.value.find((item) => item.code === CHAT_PERMISSION_CODE)?.id || '');
const answerPermissionId = computed(() => permissions.value.find((item) => item.code === ANSWER_PERMISSION_CODE)?.id || '');
const generalKnowledgePermissionId = computed(() => permissions.value.find((item) => item.code === GENERAL_KNOWLEDGE_PERMISSION_CODE)?.id || '');

function hasChatPermission(role: PlatformRecord) {
  return (role.permissions || []).some((permission: PlatformRecord) => permission.code === CHAT_PERMISSION_CODE);
}

function hasAnswerPermission(role: PlatformRecord) {
  return (role.permissions || []).some((permission: PlatformRecord) => permission.code === ANSWER_PERMISSION_CODE);
}

function hasGeneralKnowledgePermission(role: PlatformRecord) {
  return (role.permissions || []).some((permission: PlatformRecord) => permission.code === GENERAL_KNOWLEDGE_PERMISSION_CODE);
}

async function load() {
  loading.value = true;
  try {
    const [loadedRoles, loadedPermissions] = await Promise.all([listRoles(), listPermissions()]);
    roles.value = loadedRoles.filter((role) => role.code !== 'ai_user');
    permissions.value = loadedPermissions;
    if (!chatPermissionId.value || !answerPermissionId.value || !generalKnowledgePermissionId.value) ElMessage.error('AI 问答权限尚未完整初始化，请执行最新数据库迁移');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '问答权限加载失败');
  } finally {
    loading.value = false;
  }
}

async function updatePermission(role: PlatformRecord, code: string, enabled: boolean, label: string) {
  const id = permissions.value.find((permission) => permission.code === code)?.id || '';
  if (!id) return;
  savingRoleId.value = role.id;
  try {
    const currentIds = new Set<string>(role.permissionIds || []);
    if (enabled) currentIds.add(id);
    else currentIds.delete(id);
    await updateRolePermissions(role.id, { permissionIds: [...currentIds] });
    ElMessage.success(`${role.name}的${label}权限已${enabled ? '开启' : '关闭'}`);
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '权限保存失败');
  } finally {
    savingRoleId.value = '';
  }
}

function openRolePermissions() {
  void router.push({ path: '/users', query: { section: 'roles', permission: CHAT_PERMISSION_CODE } });
}

onMounted(load);
</script>

<style scoped>
.ai-chat-permission-panel { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 16px; }
.permission-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.permission-head h2 { margin: 0 0 6px; font-size: 18px; }
.permission-head p { margin: 0; }
.permission-head code { color: var(--el-color-primary); }
.permission-table-shell { flex: 1; min-height: 260px; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
.role-cell { display: grid; gap: 4px; min-width: 0; }
.role-cell strong, .role-cell small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role-cell small { color: var(--el-text-color-secondary); }
.permission-switch-cell { display: flex; align-items: center; gap: 10px; }
@media (max-width: 720px) {
  .permission-head { align-items: stretch; flex-direction: column; }
}
</style>
