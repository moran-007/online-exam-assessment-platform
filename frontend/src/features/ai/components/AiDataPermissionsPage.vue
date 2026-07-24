<template>
  <div class="ai-data-permissions-page">
    <div class="permission-head">
      <div>
        <h2>AI 数据权限</h2>
        <p class="muted">按动态角色分配模型可读取的数据范围与实名输出能力。</p>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Setting" @click="openRolePermissions">完整角色权限</el-button>
      </div>
    </div>

    <el-alert type="warning" :closable="false" show-icon>
      <template #title>双重授权</template>
      班级、成绩、考勤、排课等数据必须同时具备业务权限和 AI 权限，并受当前用户数据范围约束。题库、试卷使用独立 AI 授权，学生无需获得后台管理入口。
    </el-alert>

    <div class="permission-table-shell">
      <el-table v-loading="loading" :data="roles" height="100%">
        <el-table-column label="角色" min-width="180" fixed="left">
          <template #default="{ row }">
            <div class="role-cell">
              <strong>{{ row.name }}</strong><small>{{ row.code }} · {{ row.userCount || 0 }} 人</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column
          v-for="domain in domains"
          :key="domain.permission"
          :label="domain.name"
          width="155"
          align="center"
        >
          <template #header>
            <el-tooltip placement="top" :content="permissionRequirement(domain)">
              <span class="domain-header">{{ domain.name }}<small>{{ categoryLabel(domain.category) }}</small></span>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <template v-if="row.code === 'super_admin'">
              <el-switch :model-value="true" disabled /><div class="cell-note">系统保留</div>
            </template>
            <template v-else>
              <el-switch
                :model-value="hasPermission(row, domain.permission)"
                :loading="savingKey === `${row.id}:${domain.permission}`"
                :disabled="row.status !== 'ACTIVE' || !permissionId(domain.permission)"
                @change="(enabled) => updateDomainPermission(row, domain.permission, Boolean(enabled))"
              />
              <div class="cell-note">
                {{ domain.businessPermission
                  ? (hasPermission(row, domain.businessPermission) ? '业务权限已具备' : '还缺业务权限')
                  : 'AI 独立授权' }}
              </div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" fixed="right">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">{{ row.status === 'ACTIVE' ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh, Setting } from '@element-plus/icons-vue';
import { useRouter } from 'vue-router';
import { listPermissions, listRoles, updateRolePermissions, type PlatformRecord } from '../../platform/api';

const domains = [
  { name: '题库', description: '按题目名称或粘贴的题目内容检索题库', category: 'learning', permission: 'ai.data.question-bank', businessPermission: null },
  { name: '试卷', description: '按试卷名称检索试卷结构和题目', category: 'learning', permission: 'ai.data.papers', businessPermission: null },
  { name: '班级', description: '查询权限范围内的班级、空班级及成员数量', category: 'teaching', permission: 'ai.data.classes', businessPermission: 'class:read' },
  { name: '考试安排', description: '查询权限范围内的考试名称、状态和时间安排', category: 'teaching', permission: 'ai.data.exams', businessPermission: 'exam:read' },
  { name: '成绩历史', description: '考试成绩、题目表现、知识点掌握及历史趋势', category: 'student', permission: 'ai.data.grade-history', businessPermission: 'grading:score:read' },
  { name: '出勤情况', description: '到课、迟到、请假、早退与缺勤记录', category: 'student', permission: 'ai.data.attendance', businessPermission: 'attendance:read' },
  { name: '排课情况', description: '课次时间、课程安排及课堂公开记录', category: 'teaching', permission: 'ai.data.schedule', businessPermission: 'schedule:read' },
  { name: '学生实名', description: '向模型发送并允许输出学生真实姓名', category: 'identity', permission: 'ai.data.student-identity', businessPermission: 'student:identity:read' },
  { name: '教师实名', description: '向模型发送并允许输出教师真实姓名', category: 'identity', permission: 'ai.data.teacher-identity', businessPermission: 'academic-profile:read' },
  { name: '教师资料', description: '教学记录、课堂表现、备课内容与内部备注', category: 'teaching', permission: 'ai.data.teacher-materials', businessPermission: 'lesson-record:read' },
] as const;

const router = useRouter();
const roles = ref<PlatformRecord[]>([]);
const permissions = ref<PlatformRecord[]>([]);
const loading = ref(false);
const savingKey = ref('');

function hasPermission(role: PlatformRecord, code: string) {
  return (role.permissions || []).some((permission: PlatformRecord) => permission.code === code);
}

function permissionId(code: string) {
  return permissions.value.find((permission) => permission.code === code)?.id || '';
}

async function load() {
  loading.value = true;
  try {
    [roles.value, permissions.value] = await Promise.all([listRoles(), listPermissions()]);
    const missing = domains.filter((domain) => !permissionId(domain.permission));
    if (missing.length) ElMessage.error('部分 AI 数据权限尚未初始化，请执行最新数据库迁移');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'AI 数据权限加载失败');
  } finally {
    loading.value = false;
  }
}

async function updateDomainPermission(role: PlatformRecord, code: string, enabled: boolean) {
  const id = permissionId(code);
  if (!id) return;
  savingKey.value = `${role.id}:${code}`;
  try {
    const currentIds = new Set<string>(role.permissionIds || []);
    if (enabled) currentIds.add(id);
    else currentIds.delete(id);
    await updateRolePermissions(role.id, { permissionIds: [...currentIds] });
    ElMessage.success(`${role.name}的${domains.find((domain) => domain.permission === code)?.name || '数据'}权限已${enabled ? '开启' : '关闭'}`);
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '权限保存失败');
  } finally {
    savingKey.value = '';
  }
}

function categoryLabel(category: string) {
  return ({ learning: '学习内容', student: '学生数据', teaching: '教学数据', identity: '实名信息' } as Record<string, string>)[category] || category;
}

function permissionRequirement(domain: (typeof domains)[number]) {
  return domain.businessPermission
    ? `${domain.description}；还需 ${domain.businessPermission}`
    : `${domain.description}；此项为 AI 独立授权`;
}

function openRolePermissions() {
  void router.push({ path: '/users', query: { section: 'roles', permission: 'ai.data' } });
}

onMounted(load);
</script>

<style scoped>
.ai-data-permissions-page { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
.permission-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.permission-head h2 { margin: 0 0 6px; font-size: 18px; }
.permission-head p { margin: 0; }
.permission-table-shell { flex: 1; min-height: 280px; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
.role-cell { display: grid; gap: 4px; min-width: 0; }
.role-cell strong, .role-cell small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role-cell small, .cell-note { color: var(--el-text-color-secondary); font-size: 11px; }
.domain-header { display: inline-grid; gap: 2px; cursor: help; }
.domain-header small { color: var(--el-text-color-secondary); font-weight: 400; }
.cell-note { margin-top: 3px; }
@media (max-width: 720px) { .permission-head { align-items: stretch; flex-direction: column; } }
</style>
