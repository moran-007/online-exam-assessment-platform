<template>
  <div class="ai-data-permissions-page">
    <div class="permission-head">
      <div>
        <h2>AI 用户读取权限</h2>
        <p class="muted">AI 用户是独立的全局只读上限；实际查询仍同时受提问用户权限和数据范围限制。</p>
      </div>
      <div class="toolbar">
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
        <el-button type="primary" :icon="Setting" :disabled="!config" @click="openPermissionDrawer">完整读取权限</el-button>
      </div>
    </div>

    <el-alert type="warning" :closable="false" show-icon>
      <template #title>特殊角色：AI 用户（ai_user）</template>
      初始默认开启全部读取类权限；新功能登记读取权限后会自动补给。超级管理员可验证当前密码后手动关闭，已关闭的旧权限不会被权限同步重新打开。
    </el-alert>

    <section v-if="config" class="ai-user-summary">
      <div>
        <strong>{{ config.role.name }}</strong>
        <el-tag type="warning" effect="plain">{{ config.role.code }}</el-tag>
        <el-tag :type="config.role.status === 'ACTIVE' ? 'success' : 'info'">
          {{ config.role.status === 'ACTIVE' ? '启用' : '停用' }}
        </el-tag>
      </div>
      <span class="muted">已开启 {{ config.role.permissionIds.length }} / {{ config.availablePermissions.length }} 项只读权限</span>
    </section>

    <div class="permission-table-shell">
      <el-table v-loading="loading" :data="domains" height="100%">
        <el-table-column label="数据域" min-width="170" fixed="left">
          <template #default="{ row }">
            <div class="domain-cell">
              <strong>{{ row.name }}</strong>
              <small>{{ categoryLabel(row.category) }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="AI 可读取内容" min-width="330" show-overflow-tooltip />
        <el-table-column label="所需只读权限" min-width="300">
          <template #default="{ row }">
            <div class="permission-code-list">
              <code v-for="code in requiredCodes(row)" :key="code">{{ code }}</code>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="全局上限" width="170" fixed="right">
          <template #default="{ row }">
            <el-switch
              :model-value="domainEnabled(row)"
              :disabled="!domainAvailable(row) || saving"
              active-text="允许读取"
              inactive-text="禁止读取"
              @change="(enabled) => requestDomainChange(row, Boolean(enabled))"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-drawer v-model="permissionDrawerVisible" title="AI 用户完整读取权限" size="520px" destroy-on-close>
      <div class="permission-drawer">
        <el-alert
          type="info"
          :closable="false"
          title="这里只显示后端认定的读取类权限；AI 用户不能获得创建、修改、删除、发布或管理权限。"
        />
        <el-input v-model="permissionKeyword" clearable placeholder="按名称或权限编码筛选" />
        <div class="permission-groups">
          <section v-for="group in filteredPermissionGroups" :key="group.code" class="permission-group">
            <h3>{{ group.name }}</h3>
            <el-checkbox-group v-model="draftPermissionIds">
              <el-checkbox v-for="permission in group.permissions" :key="permission.id" :value="permission.id">
                <span class="permission-option">
                  <span>{{ permission.name }}</span>
                  <code>{{ permission.code }}</code>
                </span>
              </el-checkbox>
            </el-checkbox-group>
          </section>
        </div>
        <div class="permission-drawer-footer">
          <el-button @click="permissionDrawerVisible = false">取消</el-button>
          <el-button type="primary" :icon="Key" @click="requestFullSave">验证密码并保存</el-button>
        </div>
      </div>
    </el-drawer>

    <el-dialog v-model="passwordDialogVisible" title="验证超级管理员密码" width="460px" destroy-on-close>
      <el-alert
        type="warning"
        :closable="false"
        title="AI 用户读取范围属于敏感配置，每次保存都必须验证当前登录管理员密码。"
      />
      <el-form label-width="92px" class="password-form" @submit.prevent>
        <el-form-item label="当前密码">
          <el-input
            v-model="adminPassword"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入当前登录账号密码"
            @keyup.enter="confirmPermissionChange"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelPasswordDialog">取消</el-button>
        <el-button type="primary" :icon="Key" :loading="saving" @click="confirmPermissionChange">验证并保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Key, Refresh, Setting } from '@element-plus/icons-vue';
import {
  getAiUserPermissionConfig,
  updateAiUserPermissionConfig,
  type AiUserPermissionConfig,
  type AiUserPermissionRecord,
} from '../api';

type Domain = {
  name: string;
  description: string;
  category: string;
  permission: string;
  businessPermission: string;
};

const domains: Domain[] = [
  { name: '题库', description: '按题目名称或内容检索题库', category: 'learning', permission: 'ai.data.question-bank', businessPermission: 'question:read' },
  { name: '试卷', description: '检索试卷结构和题目', category: 'learning', permission: 'ai.data.papers', businessPermission: 'paper:read' },
  { name: '教案', description: '统计和列出系统通用教案及调用者可见的个人教案', category: 'teaching', permission: 'ai.data.lesson-plans', businessPermission: 'lesson-plan:read' },
  { name: '班级', description: '查询权限范围内的班级、空班级及成员数量', category: 'teaching', permission: 'ai.data.classes', businessPermission: 'class:read' },
  { name: '考试安排', description: '查询权限范围内的考试名称、状态和时间安排', category: 'teaching', permission: 'ai.data.exams', businessPermission: 'exam:read' },
  { name: '成绩历史', description: '考试成绩、题目表现、知识点掌握及历史趋势', category: 'student', permission: 'ai.data.grade-history', businessPermission: 'grading:score:read' },
  { name: '出勤情况', description: '到课、迟到、请假、早退与缺勤记录', category: 'student', permission: 'ai.data.attendance', businessPermission: 'attendance:read' },
  { name: '排课情况', description: '课次时间、课程安排及课堂公开记录', category: 'teaching', permission: 'ai.data.schedule', businessPermission: 'schedule:read' },
  { name: '学生实名', description: '向模型发送并允许输出学生真实姓名', category: 'identity', permission: 'ai.data.student-identity', businessPermission: 'student:identity:read' },
  { name: '教师实名', description: '向模型发送并允许输出教师真实姓名', category: 'identity', permission: 'ai.data.teacher-identity', businessPermission: 'academic-profile:read' },
  { name: '教师资料', description: '教学记录、课堂表现、备课内容与内部备注', category: 'teaching', permission: 'ai.data.teacher-materials', businessPermission: 'lesson-record:read' },
];

type PermissionGroup = { code: string; name: string; permissions: AiUserPermissionRecord[] };

const config = ref<AiUserPermissionConfig | null>(null);
const loading = ref(false);
const saving = ref(false);
const permissionDrawerVisible = ref(false);
const passwordDialogVisible = ref(false);
const permissionKeyword = ref('');
const draftPermissionIds = ref<string[]>([]);
const pendingPermissionIds = ref<string[] | null>(null);
const adminPassword = ref('');

const permissionByCode = computed(() =>
  new Map((config.value?.availablePermissions || []).map((permission) => [permission.code, permission])));
const currentPermissionIds = computed(() => new Set(config.value?.role.permissionIds || []));
const permissionGroups = computed<PermissionGroup[]>(() => {
  const groups = new Map<string, PermissionGroup>();
  for (const permission of config.value?.availablePermissions || []) {
    const code = permission.code.startsWith('ai.') ? 'ai' : permission.code.split(':')[0];
    if (!groups.has(code)) {
      groups.set(code, { code, name: groupName(code), permissions: [] });
    }
    groups.get(code)?.permissions.push(permission);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
});
const filteredPermissionGroups = computed(() => {
  const keyword = permissionKeyword.value.trim().toLowerCase();
  if (!keyword) return permissionGroups.value;
  return permissionGroups.value
    .map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) =>
        permission.name.toLowerCase().includes(keyword) || permission.code.toLowerCase().includes(keyword)),
    }))
    .filter((group) => group.permissions.length);
});

async function load() {
  loading.value = true;
  try {
    config.value = await getAiUserPermissionConfig();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'AI 用户权限加载失败');
  } finally {
    loading.value = false;
  }
}

function requiredCodes(value: unknown) {
  const domain = value as Domain;
  return [domain.permission, domain.businessPermission];
}

function domainAvailable(value: unknown) {
  return requiredCodes(value).every((code) => permissionByCode.value.has(code));
}

function domainEnabled(value: unknown) {
  return requiredCodes(value).every((code) => {
    const permission = permissionByCode.value.get(code);
    return Boolean(permission && currentPermissionIds.value.has(permission.id));
  });
}

function requestDomainChange(value: unknown, enabled: boolean) {
  const next = new Set(currentPermissionIds.value);
  for (const code of requiredCodes(value)) {
    const permission = permissionByCode.value.get(code);
    if (!permission) continue;
    if (enabled) next.add(permission.id);
    else next.delete(permission.id);
  }
  requestPassword([...next]);
}

function openPermissionDrawer() {
  draftPermissionIds.value = [...currentPermissionIds.value];
  permissionKeyword.value = '';
  permissionDrawerVisible.value = true;
}

function requestFullSave() {
  requestPassword([...draftPermissionIds.value]);
}

function requestPassword(permissionIds: string[]) {
  pendingPermissionIds.value = permissionIds;
  adminPassword.value = '';
  passwordDialogVisible.value = true;
}

function cancelPasswordDialog() {
  passwordDialogVisible.value = false;
  pendingPermissionIds.value = null;
  adminPassword.value = '';
}

async function confirmPermissionChange() {
  if (!pendingPermissionIds.value) return;
  if (adminPassword.value.length < 6) {
    ElMessage.warning('请输入当前登录管理员密码');
    return;
  }
  saving.value = true;
  try {
    await updateAiUserPermissionConfig({
      permissionIds: pendingPermissionIds.value,
      password: adminPassword.value,
    });
    ElMessage.success('AI 用户读取权限已保存');
    passwordDialogVisible.value = false;
    permissionDrawerVisible.value = false;
    pendingPermissionIds.value = null;
    adminPassword.value = '';
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'AI 用户权限保存失败');
  } finally {
    saving.value = false;
  }
}

function categoryLabel(category: string) {
  return ({ learning: '学习内容', student: '学生数据', teaching: '教学数据', identity: '实名信息' } as Record<string, string>)[category] || category;
}

function groupName(code: string) {
  return ({
    ai: 'AI 数据开关',
    course: '课程',
    'knowledge-point': '知识点',
    tag: '标签',
    question: '题库',
    paper: '试卷',
    exam: '考试',
    class: '班级',
    grading: '成绩与批改',
    student: '学生身份',
    export: '导出',
    attachment: '附件',
    hydro: '外部判题',
    'academic-profile': '教务档案',
    'lesson-type': '课型',
    'course-unit': '课程单元',
    schedule: '排课',
    attendance: '考勤',
    'lesson-hour': '课时',
    'lesson-record': '教学记录',
    'lesson-plan': '教案',
    'lesson-asset': '教学附件',
    'scratch-template': 'Scratch 模板',
    'scratch-assignment': 'Scratch 任务',
    'scratch-work': 'Scratch 作品',
    'scratch-asset': 'Scratch 文件',
    statistics: '统计',
    dashboard: '看板',
    'audit-log': '审计',
  } as Record<string, string>)[code] || code;
}

onMounted(load);
</script>

<style scoped>
.ai-data-permissions-page { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 14px; overflow: hidden; }
.permission-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.permission-head h2 { margin: 0 0 6px; font-size: 18px; }
.permission-head p { margin: 0; }
.ai-user-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
.ai-user-summary > div { display: flex; align-items: center; gap: 8px; }
.permission-table-shell { flex: 1; min-height: 260px; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: 10px; }
.domain-cell { display: grid; gap: 4px; }
.domain-cell small { color: var(--el-text-color-secondary); }
.permission-code-list { display: flex; gap: 6px; flex-wrap: wrap; }
.permission-code-list code, .permission-option code { color: var(--el-color-primary); font-size: 11px; }
.permission-drawer { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 12px; }
.permission-groups { flex: 1; min-height: 0; overflow-y: auto; display: grid; align-content: start; gap: 14px; padding-right: 4px; }
.permission-group { border: 1px solid var(--el-border-color-lighter); border-radius: 8px; padding: 10px 12px; }
.permission-group h3 { margin: 0 0 8px; font-size: 14px; }
.permission-group :deep(.el-checkbox-group) { display: grid; gap: 8px; }
.permission-group :deep(.el-checkbox) { height: auto; margin-right: 0; align-items: flex-start; }
.permission-option { display: grid; gap: 2px; white-space: normal; }
.permission-drawer-footer { display: flex; justify-content: flex-end; gap: 10px; }
.password-form { margin-top: 18px; }
@media (max-width: 720px) {
  .permission-head, .ai-user-summary { align-items: stretch; flex-direction: column; }
}
</style>
