<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">个人信息</h1>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="panel profile-panel">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="姓名">{{ user?.realName || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="账号">{{ user?.username }}</el-descriptions-item>
        <el-descriptions-item label="身份">{{ roleName }}</el-descriptions-item>
        <el-descriptions-item label="用户 ID">{{ user?.id }}</el-descriptions-item>
        <el-descriptions-item label="角色">{{ user?.roles?.join('、') || '无' }}</el-descriptions-item>
        <el-descriptions-item label="权限数量">{{ user?.permissions?.length || 0 }}</el-descriptions-item>
      </el-descriptions>
    </div>

    <el-alert
      v-if="user?.mustChangePassword"
      title="该账号由管理员激活或重置，请先在本页修改初始密码。"
      type="warning"
      :closable="false"
      show-icon
    />

    <template v-if="user?.userType === 'STUDENT'">
      <StudentExamSummaryCard v-for="summary in studentSummaries" :key="summary.id" :summary="summary" />
      <div v-if="!studentSummaries.length" class="panel profile-panel">
        <el-empty description="暂无教师已发布的阶段总结" :image-size="72" />
      </div>
    </template>

    <div class="panel profile-panel">
      <div class="paper-preview-head">
        <div>
          <h2>修改密码</h2>
          <span class="muted">更新当前登录账号的密码</span>
        </div>
      </div>
      <el-form label-width="112px" class="password-form">
        <el-form-item label="当前密码">
          <el-input v-model="passwordForm.currentPassword" type="password" show-password placeholder="请输入当前密码" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="passwordForm.newPassword" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password placeholder="再次输入新密码" />
        </el-form-item>
        <el-form-item label="操作">
          <el-button type="primary" :loading="passwordSaving" @click="changePassword">保存新密码</el-button>
        </el-form-item>
      </el-form>
    </div>

    <div v-if="academicProfile" class="panel profile-panel">
      <div class="paper-preview-head"><div><h2>{{ user?.userType === 'STUDENT' ? '学生档案' : '教师档案' }}</h2><span class="muted">由教务管理员维护的基础档案</span></div></div>
      <el-descriptions :column="2" border>
        <template v-if="user?.userType === 'STUDENT'">
          <el-descriptions-item label="学号">{{ academicProfile.studentProfile?.studentNo || '-' }}</el-descriptions-item>
          <el-descriptions-item label="在读状态">{{ academicProfile.studentProfile?.enrollmentStatus || '-' }}</el-descriptions-item>
          <el-descriptions-item label="学校">{{ academicProfile.studentProfile?.school || '-' }}</el-descriptions-item>
          <el-descriptions-item label="年级">{{ academicProfile.studentProfile?.grade || '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前班级" :span="2">{{ academicProfile.studentClasses?.map((item) => item.classGroup.name).join('、') || '未分班' }}</el-descriptions-item>
        </template>
        <template v-else>
          <el-descriptions-item label="工号">{{ academicProfile.teacherProfile?.employeeNo || '-' }}</el-descriptions-item>
          <el-descriptions-item label="在职状态">{{ academicProfile.teacherProfile?.employmentStatus || '-' }}</el-descriptions-item>
          <el-descriptions-item label="任教学科">{{ academicProfile.teacherProfile?.subject || '-' }}</el-descriptions-item>
          <el-descriptions-item label="任教班级">{{ academicProfile.teachingClasses?.map((item) => item.classGroup.name).join('、') || '暂无' }}</el-descriptions-item>
        </template>
      </el-descriptions>
    </div>

    <div v-if="user?.userType === 'PARENT'" class="panel profile-panel">
      <div class="paper-preview-head"><div><h2>明确关联学生</h2><span class="muted">只能查看教务管理员已建立关系的学生</span></div></div>
      <el-empty v-if="!children.length" description="尚未关联学生，请联系教务管理员" :image-size="72" />
      <template v-else>
        <el-descriptions v-for="item in children" :key="item.student.id" :column="2" border class="child-profile">
          <el-descriptions-item label="学生">{{ item.student.realName || item.student.username }}</el-descriptions-item>
          <el-descriptions-item label="关系">{{ item.relationship }}{{ item.isPrimary ? '（主要联系人）' : '' }}</el-descriptions-item>
          <el-descriptions-item label="学校">{{ item.student.studentProfile?.school || '-' }}</el-descriptions-item>
          <el-descriptions-item label="年级">{{ item.student.studentProfile?.grade || '-' }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </div>

    <div v-if="canManageOwnExternalAccounts" class="panel profile-panel hydro-account-panel">
      <div class="paper-preview-head">
        <div>
          <h2>外部账号</h2>
          <span class="muted">编程题提交时使用对应 OJ 账号和语言提交测评</span>
        </div>
        <el-tag :type="hydroAccounts.length ? 'success' : 'info'">
          {{ hydroAccounts.length ? `已绑定 ${hydroAccounts.length} 个` : '未绑定' }}
        </el-tag>
      </div>

      <el-form label-width="112px" class="hydro-account-form">
        <el-form-item label="接入平台">
          <el-select v-model="hydroForm.platformCode" style="width: 220px" @change="handlePlatformChange">
            <el-option
              v-for="platform in platforms"
              :key="platform.code"
              :label="`${platform.name}（${platform.baseUrl}）`"
              :value="platform.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="OJ站点">
          <el-input v-model="hydroForm.platformBaseUrl" placeholder="https://oj.example.com" />
        </el-form-item>
        <el-form-item label="登录账号">
          <el-input v-model="hydroForm.loginUsername" placeholder="用于登录 Hydro 的账号" />
        </el-form-item>
        <el-form-item label="登录密码">
          <el-input v-model="hydroForm.loginPassword" type="password" show-password placeholder="留空表示保持原密码" />
        </el-form-item>
        <el-form-item label="Hydro用户名">
          <el-input v-model="hydroForm.hydroUsername" placeholder="例如 ceshi1" />
        </el-form-item>
        <el-form-item label="Hydro UID">
          <el-input v-model="hydroForm.hydroUserId" placeholder="不知道 UID 时可与用户名相同" />
        </el-form-item>
        <el-form-item label="操作">
          <div class="toolbar">
            <el-button type="primary" :loading="hydroSaving" @click="saveHydroAccount">保存账号</el-button>
            <el-button :disabled="!hydroForm.id" :loading="hydroTesting" @click="testHydroAccount">检测登录</el-button>
            <el-button @click="resetHydroForm">新增账号</el-button>
            <el-button :icon="Link" :disabled="!hydroForm.hydroUsername" @click="openHydroUser">打开 Hydro</el-button>
          </div>
        </el-form-item>
      </el-form>

      <el-table :data="hydroAccounts" class="hydro-account-table" size="small">
        <el-table-column label="平台" min-width="120">
          <template #default="{ row }">{{ row.platformName || row.platformCode }}</template>
        </el-table-column>
        <el-table-column prop="platformBaseUrl" label="站点" min-width="180" />
        <el-table-column prop="loginUsername" label="登录账号" min-width="140" />
        <el-table-column prop="hydroUsername" label="Hydro用户名" min-width="140" />
        <el-table-column label="密码" width="90">
          <template #default="{ row }">
            <el-tag :type="row.hasPassword ? 'success' : 'warning'">{{ row.hasPassword ? '已保存' : '未保存' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="检测" min-width="160">
          <template #default="{ row }">
            <el-tag :type="row.lastLoginStatus === 'success' ? 'success' : row.lastLoginStatus ? 'warning' : 'info'">
              {{ row.lastLoginStatus === 'success' ? '通过' : row.lastLoginMessage || '未检测' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="editHydroAccount(row)">编辑</el-button>
            <el-button link type="primary" :loading="hydroTestingId === row.id" @click="testHydroAccount(row)">检测</el-button>
            <el-button link type="danger" :icon="Delete" @click="deleteHydroAccount(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Link, Refresh } from '@element-plus/icons-vue';
import { setSession } from '../api';
import { changeOwnPassword, getCurrentProfile } from '../features/platform/api';
import { listPublishedSummaries } from '../features/ai/api';
import { getStudentProfile, getTeacherProfile, listMyChildren } from '../features/academic-profiles/api';
import StudentExamSummaryCard from '../features/ai/components/StudentExamSummaryCard.vue';
import {
  bindMyHydroAccount,
  listHydroPlatforms,
  listMyHydroAccounts,
  removeOwnHydroAccount,
  testOwnHydroAccount,
} from '../features/hydro/api';

const user = ref(null);
const studentSummaries = ref([]);
const academicProfile = ref(null);
const children = ref([]);
const hydroAccounts = ref([]);
const platforms = ref([]);
const passwordSaving = ref(false);
const hydroSaving = ref(false);
const hydroTesting = ref(false);
const hydroTestingId = ref('');
const hydroForm = reactive({
  id: '',
  platformCode: 'hydro',
  platformBaseUrl: 'https://oj.example.com',
  loginUsername: '',
  loginPassword: '',
  hydroUserId: '',
  hydroUsername: '',
  bindStatus: 'bound',
});
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const roleName = computed(() => {
  const names = {
    SUPER_ADMIN: '超级管理员',
    ADMIN: '管理员',
    TEACHER: '教师',
    ASSISTANT: '助教',
    STUDENT: '学生',
    PARENT: '家长',
  };
  return names[user.value?.userType] ?? user.value?.userType ?? '';
});

async function load() {
  user.value = await getCurrentProfile();
  setSession({ user: user.value });
  academicProfile.value = user.value?.userType === 'STUDENT'
    ? await getStudentProfile(user.value.id)
    : ['TEACHER', 'ASSISTANT'].includes(user.value?.userType)
      ? await getTeacherProfile(user.value.id)
      : null;
  children.value = user.value?.userType === 'PARENT' ? await listMyChildren() : [];
  studentSummaries.value = user.value?.userType === 'STUDENT'
    ? (await listPublishedSummaries()).filter((item) => item.type === 'student')
    : [];
  if (canManageOwnExternalAccounts.value) {
    await loadPlatforms();
    await loadHydroAccounts();
  }
}

const canManageOwnExternalAccounts = computed(() =>
  ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'ASSISTANT', 'STUDENT'].includes(user.value?.userType),
);

async function loadPlatforms() {
  platforms.value = await listHydroPlatforms();
  const platform = platforms.value[0];
  if (platform && !hydroForm.platformBaseUrl) {
    hydroForm.platformCode = platform.code;
    hydroForm.platformBaseUrl = platform.baseUrl;
  }
}

async function loadHydroAccounts() {
  hydroAccounts.value = await listMyHydroAccounts();
  if (hydroAccounts.value.length) {
    editHydroAccount(hydroAccounts.value[0]);
  } else {
    resetHydroForm();
  }
}

async function changePassword() {
  if (!passwordForm.currentPassword || !passwordForm.newPassword) {
    ElMessage.warning('请填写当前密码和新密码');
    return;
  }
  if (passwordForm.newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位');
    return;
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }

  passwordSaving.value = true;
  try {
    await changeOwnPassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
    });
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    passwordForm.confirmPassword = '';
    ElMessage.success('密码已修改');
  } catch (error) {
    ElMessage.error(error.message || '密码修改失败');
  } finally {
    passwordSaving.value = false;
  }
}

async function saveHydroAccount() {
  const loginUsername = hydroForm.loginUsername.trim();
  const hydroUsername = hydroForm.hydroUsername.trim();
  const hydroUserId = hydroForm.hydroUserId.trim() || hydroUsername;
  if (!hydroForm.platformCode || !hydroForm.platformBaseUrl.trim() || !loginUsername || !hydroUsername) {
    ElMessage.warning('请填写接入平台、登录账号和 Hydro 用户名');
    return;
  }
  if (!hydroForm.id && !hydroForm.loginPassword.trim()) {
    ElMessage.warning('新增外部账号需要填写登录密码');
    return;
  }

  hydroSaving.value = true;
  try {
    const platform = platforms.value.find((item) => item.code === hydroForm.platformCode);
    const saved = await bindMyHydroAccount({
        id: hydroForm.id || undefined,
        platformCode: hydroForm.platformCode,
        platformName: platform?.name,
        platformBaseUrl: hydroForm.platformBaseUrl,
        loginUsername,
        loginPassword: hydroForm.loginPassword.trim() || undefined,
        hydroUsername,
        hydroUserId,
        bindStatus: hydroForm.bindStatus,
    });
    editHydroAccount(saved);
    await loadHydroAccounts();
    ElMessage.success('外部账号已保存');
  } catch (error) {
    ElMessage.error(error.message || '外部账号保存失败');
  } finally {
    hydroSaving.value = false;
  }
}

async function testHydroAccount(row = null) {
  const accountId = row?.id || hydroForm.id;
  if (!accountId) {
    ElMessage.warning('请先保存账号');
    return;
  }
  hydroTesting.value = !row;
  hydroTestingId.value = accountId;
  try {
    const result = await testOwnHydroAccount(accountId);
    await loadHydroAccounts();
    ElMessage[result.success ? 'success' : 'warning'](result.message || '检测完成');
  } catch (error) {
    ElMessage.error(error.message || '检测失败');
  } finally {
    hydroTesting.value = false;
    hydroTestingId.value = '';
  }
}

async function deleteHydroAccount(row) {
  try {
    await ElMessageBox.confirm(`确认删除外部账号「${row.hydroUsername || row.loginUsername}」吗？`, '删除外部账号', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
    await removeOwnHydroAccount(row.id);
    await loadHydroAccounts();
    ElMessage.success('外部账号已删除');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error.message || '删除失败');
    }
  }
}

function editHydroAccount(account) {
  hydroForm.id = account.id || '';
  hydroForm.platformCode = account.platformCode || 'hydro';
  hydroForm.platformBaseUrl = account.platformBaseUrl || defaultPlatformBaseUrl();
  hydroForm.loginUsername = account.loginUsername || '';
  hydroForm.loginPassword = '';
  hydroForm.hydroUsername = account.hydroUsername || account.loginUsername || user.value?.username || '';
  hydroForm.hydroUserId = account.hydroUserId || hydroForm.hydroUsername;
  hydroForm.bindStatus = account.bindStatus || 'bound';
}

function resetHydroForm() {
  hydroForm.id = '';
  hydroForm.platformCode = platforms.value[0]?.code || 'hydro';
  hydroForm.platformBaseUrl = platforms.value[0]?.baseUrl || 'https://oj.example.com';
  hydroForm.loginUsername = user.value?.username || '';
  hydroForm.loginPassword = '';
  hydroForm.hydroUsername = user.value?.username || '';
  hydroForm.hydroUserId = hydroForm.hydroUsername;
  hydroForm.bindStatus = 'bound';
}

function handlePlatformChange(code) {
  const platform = platforms.value.find((item) => item.code === code);
  if (platform) hydroForm.platformBaseUrl = platform.baseUrl;
}

function defaultPlatformBaseUrl() {
  return platforms.value.find((item) => item.code === hydroForm.platformCode)?.baseUrl || 'https://oj.example.com';
}

function openHydroUser() {
  if (!hydroForm.hydroUsername) return;
  const userPath = hydroForm.hydroUserId.trim() || hydroForm.hydroUsername.trim();
  const baseUrl = hydroForm.platformBaseUrl.replace(/\/+$/, '') || 'https://oj.example.com';
  window.open(`${baseUrl}/user/${encodeURIComponent(userPath)}`, '_blank', 'noopener,noreferrer');
}

onMounted(load);
</script>
