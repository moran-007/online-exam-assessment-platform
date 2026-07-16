<template>
  <div class="page academic-profile-page">
    <div class="page-head">
      <h1 class="page-title">教务档案</h1>
      <div class="toolbar">
        <el-input v-model="keyword" clearable placeholder="账号 / 姓名 / 编号" @keyup.enter="load" @clear="load" />
        <el-button :icon="Search" @click="load">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button v-if="activeTab === 'parents'" type="primary" :icon="Link" @click="openParentLink()">关联家长</el-button>
      </div>
    </div>

    <section class="panel profile-table-panel">
      <el-tabs v-model="activeTab">
        <el-tab-pane label="学生档案" name="students">
          <el-table v-loading="loading" :data="students" height="100%">
            <el-table-column label="学生" min-width="180">
              <template #default="{ row }"><strong>{{ row.realName || row.username }}</strong><div class="muted">{{ row.username }}</div></template>
            </el-table-column>
            <el-table-column label="学号" min-width="130"><template #default="{ row }">{{ row.studentProfile?.studentNo || '-' }}</template></el-table-column>
            <el-table-column label="学校 / 年级" min-width="180">
              <template #default="{ row }">{{ [row.studentProfile?.school, row.studentProfile?.grade].filter(Boolean).join(' · ') || '-' }}</template>
            </el-table-column>
            <el-table-column label="当前班级" min-width="220">
              <template #default="{ row }">
                <div class="tag-list"><el-tag v-for="item in row.studentClasses" :key="item.classGroup.id" type="info">{{ item.classGroup.name }}</el-tag><span v-if="!row.studentClasses?.length" class="muted">未分班</span></div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag>{{ profileStatus(row, 'student') }}</el-tag></template></el-table-column>
            <el-table-column label="账号激活" width="120"><template #default="{ row }"><el-tag :type="row.status === 'PENDING_ACTIVATION' ? 'warning' : 'success'">{{ row.status === 'PENDING_ACTIVATION' ? '待激活' : row.mustChangePassword ? '首次改密' : '已激活' }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" :icon="Edit" @click="openStudent(row)">编辑档案</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="教师档案" name="teachers">
          <el-table v-loading="loading" :data="teachers" height="100%">
            <el-table-column label="教师" min-width="180"><template #default="{ row }"><strong>{{ row.realName || row.username }}</strong><div class="muted">{{ row.username }}</div></template></el-table-column>
            <el-table-column label="工号" min-width="130"><template #default="{ row }">{{ row.teacherProfile?.employeeNo || '-' }}</template></el-table-column>
            <el-table-column label="任教学科" min-width="150"><template #default="{ row }">{{ row.teacherProfile?.subject || '-' }}</template></el-table-column>
            <el-table-column label="任教班级" min-width="240">
              <template #default="{ row }"><div class="tag-list"><el-tag v-for="item in row.teachingClasses" :key="item.classGroup.id" type="info">{{ item.classGroup.name }} · {{ teacherRole(item.role) }}</el-tag><span v-if="!row.teachingClasses?.length" class="muted">暂无任教班级</span></div></template>
            </el-table-column>
            <el-table-column label="状态" width="120"><template #default="{ row }"><el-tag>{{ profileStatus(row, 'teacher') }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" :icon="Edit" @click="openTeacher(row)">编辑档案</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="家长关系" name="parents">
          <el-table v-loading="loading" :data="parents" height="100%">
            <el-table-column label="家长" min-width="180"><template #default="{ row }"><strong>{{ row.realName || row.username }}</strong><div class="muted">{{ row.username }}</div></template></el-table-column>
            <el-table-column prop="phone" label="手机号" min-width="150" />
            <el-table-column label="明确关联学生" min-width="360">
              <template #default="{ row }">
                <div class="relation-list">
                  <span v-for="item in row.parentStudents" :key="item.student.id">
                    <el-tag :type="item.isPrimary ? 'success' : 'info'">{{ item.student.realName || item.student.username }} · {{ item.relationship }}</el-tag>
                    <el-button link type="danger" @click="unlink(row, item.student)">解除</el-button>
                  </span>
                  <span v-if="!row.parentStudents?.length" class="muted">尚未关联学生</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button link type="primary" :icon="Link" @click="openParentLink(row)">关联学生</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="迁移演练" name="migrations">
          <el-alert title="Gate C：身份冲突清零或逐项签字前，不允许迁移课次、考勤和课时。" type="warning" :closable="false" show-icon />
          <el-table v-loading="loading" :data="migrationRuns" height="calc(100% - 54px)">
            <el-table-column prop="sourceSystem" label="来源" width="130" />
            <el-table-column label="档案规模" min-width="260"><template #default="{ row }">学生 {{ row.summary?.students || 0 }} · 教师 {{ row.summary?.teachers || 0 }} · 家长 {{ row.summary?.parents || 0 }} · 班级 {{ row.summary?.classes || 0 }}</template></el-table-column>
            <el-table-column label="密码读取" width="110"><template #default="{ row }"><el-tag type="success">{{ row.summary?.passwordFieldsRead || 0 }} 字段</el-tag></template></el-table-column>
            <el-table-column prop="conflictCount" label="冲突" width="80" />
            <el-table-column label="状态" width="150"><template #default="{ row }"><el-tag :type="migrationStatusType(row.status)">{{ migrationStatus(row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="操作" width="100"><template #default="{ row }"><el-button link type="primary" @click="openMigration(row)">查看处置</el-button></template></el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-dialog v-model="profileVisible" :title="profileType === 'student' ? '编辑学生档案' : '编辑教师档案'" width="620px" destroy-on-close>
      <el-form :model="profileForm" label-width="96px">
        <template v-if="profileType === 'student'">
          <el-form-item label="学号"><el-input v-model="profileForm.studentNo" /></el-form-item>
          <el-form-item label="性别"><el-input v-model="profileForm.gender" /></el-form-item>
          <el-form-item label="学校"><el-input v-model="profileForm.school" /></el-form-item>
          <el-form-item label="年级"><el-input v-model="profileForm.grade" /></el-form-item>
        </template>
        <template v-else>
          <el-form-item label="工号"><el-input v-model="profileForm.employeeNo" /></el-form-item>
          <el-form-item label="任教学科"><el-input v-model="profileForm.subject" /></el-form-item>
        </template>
        <el-form-item label="档案状态"><el-select v-model="profileForm.status" style="width: 100%"><el-option label="在读 / 在职" value="active" /><el-option label="停用 / 离职" value="inactive" /></el-select></el-form-item>
        <el-form-item :label="profileType === 'student' ? '入学日期' : '入职日期'"><el-date-picker v-model="profileForm.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="profileForm.notes" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="profileVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveProfile">保存档案</el-button></template>
    </el-dialog>

    <el-dialog v-model="parentVisible" title="关联家长与学生" width="560px" destroy-on-close>
      <el-form :model="parentForm" label-width="90px">
        <el-form-item label="家长"><el-select v-model="parentForm.parentId" filterable style="width: 100%"><el-option v-for="row in parents" :key="row.id" :label="row.realName ? `${row.realName}（${row.username}）` : row.username" :value="row.id" /></el-select></el-form-item>
        <el-form-item label="学生"><el-select v-model="parentForm.studentId" filterable style="width: 100%"><el-option v-for="row in students" :key="row.id" :label="row.realName ? `${row.realName}（${row.username}）` : row.username" :value="row.id" /></el-select></el-form-item>
        <el-form-item label="关系"><el-input v-model="parentForm.relationship" placeholder="如：父亲、母亲、监护人" /></el-form-item>
        <el-form-item label="主要联系人"><el-switch v-model="parentForm.isPrimary" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="parentVisible = false">取消</el-button><el-button type="primary" @click="saveParentLink">保存关系</el-button></template>
    </el-dialog>

    <el-drawer v-model="migrationVisible" title="身份冲突处置" size="720px" destroy-on-close>
      <template v-if="migrationDetail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="来源">{{ migrationDetail.sourceSystem }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ migrationStatus(migrationDetail.status) }}</el-descriptions-item>
          <el-descriptions-item label="输入指纹" :span="2"><code>{{ migrationDetail.inputFingerprint }}</code></el-descriptions-item>
        </el-descriptions>
        <el-table :data="migrationDetail.conflicts" class="conflict-table">
          <el-table-column prop="entityType" label="对象" width="100" />
          <el-table-column prop="legacyId" label="旧 ID" min-width="110" />
          <el-table-column prop="conflictType" label="冲突类型" min-width="190" />
          <el-table-column label="说明" min-width="210"><template #default="{ row }">{{ row.summary?.message }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.status === 'OPEN' ? 'danger' : 'success'">{{ row.status === 'OPEN' ? '待处置' : '已签字' }}</el-tag></template></el-table-column>
          <el-table-column label="操作" width="110"><template #default="{ row }"><el-button v-if="row.status === 'OPEN'" link type="primary" @click="resolveConflict(row)">处置并签字</el-button></template></el-table-column>
        </el-table>
        <div class="drawer-actions"><el-button type="primary" :disabled="migrationDetail.status !== 'READY'" @click="approveMigration">批准迁移</el-button><span class="muted">批准后仍需以相同输入指纹执行，重复执行不会重复建档。</span></div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { Edit, Link, Refresh, Search } from '@element-plus/icons-vue';
import { useAcademicProfileManagement } from '../composables/useAcademicProfileManagement';

const {
  activeTab, approveMigration, keyword, load, loading, migrationDetail, migrationRuns,
  migrationVisible, openMigration, openParentLink, openStudent, openTeacher, parentForm,
  parentVisible, parents, profileForm, profileStatus, profileType, profileVisible,
  resolveConflict, saveParentLink, saveProfile, saving, students, teachers, unlink,
} = useAcademicProfileManagement();

const teacherRole = (role: string) => ({ LEAD: '负责人', INSTRUCTOR: '任课', ASSISTANT: '助教' }[role] || role);
const migrationStatus = (status: string) => ({
  PREFLIGHT_BLOCKED: '预检阻断', READY: '待批准', APPROVED: '已批准', APPLYING: '导入中',
  COMPLETED: '已完成', FAILED: '失败',
}[status] || status);
const migrationStatusType = (status: string): 'danger' | 'warning' | 'success' | 'info' => ({
  PREFLIGHT_BLOCKED: 'danger', READY: 'warning', APPROVED: 'warning', COMPLETED: 'success', FAILED: 'danger',
}[status] || 'info') as 'danger' | 'warning' | 'success' | 'info';
</script>

<style scoped>
.academic-profile-page { min-height: 0; }
.page-head .el-input { width: 260px; }
.profile-table-panel { flex: 1; min-height: 0; overflow: hidden; }
.profile-table-panel :deep(.el-tabs) { height: 100%; display: flex; flex-direction: column; }
.profile-table-panel :deep(.el-tabs__content), .profile-table-panel :deep(.el-tab-pane) { flex: 1; min-height: 0; }
.tag-list, .relation-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.relation-list > span { display: inline-flex; align-items: center; }
.conflict-table { margin-top: 18px; }
.drawer-actions { margin-top: 18px; display: flex; align-items: center; gap: 12px; }
code { word-break: break-all; }
</style>
