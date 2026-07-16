<template>
  <div class="page">
    <div class="page-head">
      <h1 class="page-title">班级管理</h1>
      <div class="toolbar">
        <el-input v-model="filter.keyword" clearable placeholder="班级关键词" @keyup.enter="loadFirstPage" @clear="loadFirstPage" />
        <el-select v-model="filter.courseId" clearable filterable placeholder="课程" @change="loadFirstPage">
          <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
        </el-select>
        <el-select v-model="filter.status" clearable placeholder="状态" @change="loadFirstPage">
          <el-option label="启用" value="active" />
          <el-option label="停用" value="disabled" />
          <el-option label="归档" value="archived" />
        </el-select>
        <el-button :icon="Search" @click="loadFirstPage">查询</el-button>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <el-button v-if="canCreateStudents" :icon="Plus" @click="openCreateStudent">新增学生</el-button>
        <el-button v-if="canCreateStudents" :icon="Upload" @click="openBatchCreateStudents">批量创建学生</el-button>
        <el-button v-if="canCreateTeachers" :icon="Upload" @click="openBatchCreateTeachers">批量创建教师</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新增班级</el-button>
      </div>
    </div>

    <div class="panel library-table-panel">
      <el-table
        :data="items"
        height="100%"
        highlight-current-row
        class="question-list-table"
        :default-sort="{ prop: filter.sortBy, order: filter.sortOrder === 'asc' ? 'ascending' : 'descending' }"
        @row-click="openDetail"
        @sort-change="handleSort"
      >
        <el-table-column prop="name" label="班级" min-width="180" sortable="custom" show-overflow-tooltip />
        <el-table-column prop="courseName" label="课程" min-width="150" show-overflow-tooltip />
        <el-table-column prop="studentCount" label="学生" width="90" />
        <el-table-column prop="teacherCount" label="教师" width="90" />
        <el-table-column prop="status" label="状态" width="100" sortable="custom">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="sortOrder" label="排序" width="90" sortable="custom" />
        <el-table-column label="操作" width="130">
          <template #default="{ row }">
            <div class="row-action-cell" @click.stop @mousedown.stop>
              <el-dropdown trigger="click" @command="(command) => handleCommand(row, command)">
                <el-button size="small" @click.stop>操作</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑</el-dropdown-item>
                    <el-dropdown-item command="members">成员</el-dropdown-item>
                    <el-dropdown-item command="remove" divided>归档</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <div class="table-footer">
        <span class="muted">共 {{ pagination.total }} 个班级</span>
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          background
          size="small"
          layout="sizes, prev, pager, next"
          :page-sizes="[20, 50, 100]"
          :total="pagination.total"
          @size-change="handleSize"
          @current-change="handleCurrent"
        />
      </div>
    </div>

    <el-dialog v-model="formVisible" :title="editingId ? '编辑班级' : '新增班级'" width="560px" destroy-on-close>
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="课程">
          <el-select v-model="form.courseId" clearable filterable style="width: 100%">
            <el-option v-for="course in courses" :key="course.id" :label="course.name" :value="course.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sortOrder" :min="0" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="3" resize="vertical" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" @click="saveClass">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" :title="detail ? `班级：${detail.name}` : '班级成员'" size="720px" destroy-on-close>
      <div v-if="detail" class="class-detail">
        <div class="detail-summary">
          <strong>{{ detail.name }}</strong>
          <span class="muted">{{ detail.courseName || '未绑定课程' }} · {{ statusLabel(detail.status) }}</span>
        </div>
        <div class="member-tools">
          <el-select v-model="selectedStudentIds" multiple filterable placeholder="选择已有学生" no-data-text="暂无可选学生">
            <el-option
              v-for="student in students"
              :key="student.id"
              :label="student.realName ? `${student.realName}（${student.username}）` : student.username"
              :value="student.id"
            />
          </el-select>
          <el-button :icon="Plus" @click="addStudents">添加学生</el-button>
          <el-button v-if="canCreateStudents" :icon="Plus" @click="openCreateStudent">新增学生</el-button>
          <el-button v-if="canCreateStudents" :icon="Upload" @click="openBatchCreateStudents">批量创建学生</el-button>
          <el-button :disabled="!batchStudents.length" @click="estimateAiBatch">AI 批量预算</el-button>
        </div>
        <el-table :data="detail.students" height="220" @selection-change="batchStudents = $event">
          <el-table-column type="selection" width="46" />
          <el-table-column prop="realName" label="学生" min-width="150" />
          <el-table-column prop="username" label="账号" min-width="150" />
          <el-table-column label="操作" width="150">
            <template #default="{ row }">
              <el-button link type="primary" @click="openStudentAi(row)">AI 总结</el-button>
              <el-button link type="danger" @click="removeStudent(row)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-divider />
        <div class="member-tools">
          <el-select v-model="selectedTeacherIds" multiple filterable placeholder="添加教师">
            <el-option
              v-for="teacher in teachers"
              :key="teacher.id"
              :label="teacher.realName ? `${teacher.realName}（${teacher.username}）` : teacher.username"
              :value="teacher.id"
            />
          </el-select>
          <el-button :icon="Plus" @click="addTeachers">添加教师</el-button>
          <el-button v-if="canCreateTeachers" :icon="Plus" @click="openCreateTeacher">新增教师</el-button>
          <el-button v-if="canCreateTeachers" :icon="Upload" @click="openBatchCreateTeachers">批量创建教师</el-button>
        </div>
        <el-table :data="detail.teachers" height="220">
          <el-table-column prop="realName" label="教师" min-width="150" />
          <el-table-column prop="username" label="账号" min-width="150" />
          <el-table-column label="操作" width="90">
            <template #default="{ row }"><el-button link type="danger" @click="removeTeacher(row)">移除</el-button></template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <el-dialog v-model="studentCreateVisible" title="新增学生" width="520px" destroy-on-close>
      <el-form :model="studentCreateForm" label-width="80px">
        <el-form-item label="账号"><el-input v-model="studentCreateForm.username" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="studentCreateForm.realName" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="studentCreateForm.password" show-password placeholder="默认 123456" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="studentCreateVisible = false">取消</el-button>
        <el-button type="primary" :icon="Plus" :loading="studentCreateLoading" @click="createStudent">新增学生</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="teacherCreateVisible" title="新增教师" width="520px" destroy-on-close>
      <el-form :model="teacherCreateForm" label-width="80px">
        <el-form-item label="账号"><el-input v-model="teacherCreateForm.username" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="teacherCreateForm.realName" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="teacherCreateForm.password" show-password placeholder="默认 123456" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="teacherCreateVisible = false">取消</el-button>
        <el-button type="primary" :icon="Plus" :loading="teacherCreateLoading" @click="createTeacher">新增教师</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="teacherBatchVisible" title="批量创建教师" width="760px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="默认密码"><el-input v-model="teacherBatchDefaultPassword" show-password /></el-form-item>
        <el-form-item label="教师名单">
          <el-input
            v-model="teacherBatchText"
            type="textarea"
            :rows="12"
            resize="vertical"
            placeholder="账号,姓名,密码&#10;teacher002,王老师,123456&#10;teacher003,李老师"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="teacherBatchVisible = false">取消</el-button>
        <el-button type="primary" :icon="Upload" :loading="teacherBatchLoading" @click="createTeachersBatch">批量创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="studentBatchVisible" title="批量创建学生" width="760px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="默认密码"><el-input v-model="studentBatchDefaultPassword" show-password /></el-form-item>
        <el-form-item label="学生名单">
          <el-input
            v-model="studentBatchText"
            type="textarea"
            :rows="12"
            resize="vertical"
            placeholder="账号,姓名,密码&#10;student002,张三,123456&#10;student003,李四"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="studentBatchVisible = false">取消</el-button>
        <el-button type="primary" :icon="Upload" :loading="studentBatchLoading" @click="createStudentsBatch">批量创建</el-button>
      </template>
    </el-dialog>
    <StudentAiSummaryDialog ref="studentAiDialog" />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search, Upload } from '@element-plus/icons-vue';
import { useClassManagementPage } from '../composables/useClassManagementPage';
import StudentAiSummaryDialog from '../../ai/components/StudentAiSummaryDialog.vue';
import { estimateStudentSummaryBatch } from '../../ai/api';

const {
  addStudents, addTeachers, canCreateStudents, canCreateTeachers, courses, createStudent,
  createStudentsBatch, createTeacher, createTeachersBatch, detail, detailVisible, editingId,
  filter, form, formVisible, handleCommand, handleCurrent, handleSize, handleSort, items, load,
  loadFirstPage, openBatchCreateStudents, openBatchCreateTeachers, openCreate, openCreateStudent,
  openCreateTeacher, openDetail, pagination, removeStudent, removeTeacher, saveClass,
  selectedStudentIds, selectedTeacherIds, statusLabel, studentBatchDefaultPassword,
  studentBatchLoading, studentBatchText, studentBatchVisible, studentCreateForm,
  studentCreateLoading, studentCreateVisible, students, teacherBatchDefaultPassword,
  teacherBatchLoading, teacherBatchText, teacherBatchVisible, teacherCreateForm,
  teacherCreateLoading, teacherCreateVisible, teachers,
} = useClassManagementPage();

const studentAiDialog = ref();
const batchStudents = ref([]);
function openStudentAi(student) {
  const name = student.realName || student.username || '学生';
  void studentAiDialog.value?.open(student.id, name, { courseId: detail.value?.courseId || undefined });
}

async function estimateAiBatch() {
  if (batchStudents.value.length > 20) {
    ElMessage.warning('首版每批最多预估 20 名学生');
    return;
  }
  try {
    const estimate = await estimateStudentSummaryBatch({
      studentIds: batchStudents.value.map((student) => student.id),
      courseId: detail.value?.courseId || undefined,
    });
    const remaining = estimate.remainingTokens === null ? '本地预算不限' : `${estimate.remainingTokens} Token`;
    const budgetState = estimate.withinLocalBudget ? '当前本地预算可覆盖' : '当前本地预算不足';
    await ElMessageBox.confirm(
      `共 ${estimate.taskCount} 个任务，每个请求上限 ${estimate.requestedOutputTokensPerTask} Token，` +
      `最坏情况预留 ${estimate.estimatedReservedTokens} Token；剩余 ${remaining}，${budgetState}。` +
      '确认本次预算？当前首版不会自动批量调用模型，请逐人生成。',
      '确认 AI 批量预算',
      { type: estimate.withinLocalBudget ? 'warning' : 'error', confirmButtonText: '确认预算' },
    );
    ElMessage.success('批量预算已确认，可按需逐人生成');
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '批量预算预估失败');
    }
  }
}
</script>
