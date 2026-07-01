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
            <el-dropdown trigger="click" @command="(command) => handleCommand(row, command)" @click.stop>
              <el-button size="small">操作</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="edit">编辑</el-dropdown-item>
                  <el-dropdown-item command="members">成员</el-dropdown-item>
                  <el-dropdown-item command="remove" divided>归档</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
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
        <el-form-item label="名称">
          <el-input v-model="form.name" />
        </el-form-item>
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
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="3" resize="vertical" />
        </el-form-item>
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
        </div>
        <el-table :data="detail.students" height="220">
          <el-table-column prop="realName" label="学生" min-width="150" />
          <el-table-column prop="username" label="账号" min-width="150" />
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
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
            <template #default="{ row }">
              <el-button link type="danger" @click="removeTeacher(row)">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>

    <el-dialog v-model="studentCreateVisible" title="新增学生" width="520px" destroy-on-close>
      <el-form :model="studentCreateForm" label-width="80px">
        <el-form-item label="账号">
          <el-input v-model="studentCreateForm.username" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="studentCreateForm.realName" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="studentCreateForm.password" show-password placeholder="默认 123456" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="studentCreateVisible = false">取消</el-button>
        <el-button type="primary" :icon="Plus" :loading="studentCreateLoading" @click="createStudent">新增学生</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="teacherCreateVisible" title="新增教师" width="520px" destroy-on-close>
      <el-form :model="teacherCreateForm" label-width="80px">
        <el-form-item label="账号">
          <el-input v-model="teacherCreateForm.username" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="teacherCreateForm.realName" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="teacherCreateForm.password" show-password placeholder="默认 123456" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="teacherCreateVisible = false">取消</el-button>
        <el-button type="primary" :icon="Plus" :loading="teacherCreateLoading" @click="createTeacher">新增教师</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="teacherBatchVisible" title="批量创建教师" width="760px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="默认密码">
          <el-input v-model="teacherBatchDefaultPassword" show-password />
        </el-form-item>
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
        <el-form-item label="默认密码">
          <el-input v-model="studentBatchDefaultPassword" show-password />
        </el-form-item>
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
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search, Upload } from '@element-plus/icons-vue';
import { api, buildQuery, getCurrentUser } from '../api';

const filter = reactive({ keyword: '', courseId: '', status: '', sortBy: 'sortOrder', sortOrder: 'asc' });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const form = reactive(baseForm());
const studentCreateForm = reactive(baseStudentCreateForm());
const teacherCreateForm = reactive(baseUserCreateForm());
const currentUser = getCurrentUser();
const canCreateStudents = ['SUPER_ADMIN', 'ADMIN', 'TEACHER'].includes(currentUser?.userType);
const canCreateTeachers = ['SUPER_ADMIN', 'ADMIN'].includes(currentUser?.userType);
const items = ref([]);
const courses = ref([]);
const students = ref([]);
const teachers = ref([]);
const detail = ref(null);
const editingId = ref('');
const formVisible = ref(false);
const detailVisible = ref(false);
const studentCreateVisible = ref(false);
const studentCreateLoading = ref(false);
const teacherCreateVisible = ref(false);
const teacherCreateLoading = ref(false);
const teacherBatchVisible = ref(false);
const teacherBatchLoading = ref(false);
const teacherBatchDefaultPassword = ref('123456');
const teacherBatchText = ref('');
const studentBatchVisible = ref(false);
const studentBatchLoading = ref(false);
const studentBatchDefaultPassword = ref('123456');
const studentBatchText = ref('');
const selectedStudentIds = ref([]);
const selectedTeacherIds = ref([]);

function baseForm() {
  return { name: '', courseId: '', description: '', status: 'active', sortOrder: 0 };
}

function baseStudentCreateForm() {
  return { username: '', realName: '', password: '' };
}

function baseUserCreateForm() {
  return { username: '', realName: '', password: '' };
}

async function load() {
  const [coursePage, studentList, teacherList, page] = await Promise.all([
    api('/courses?pageSize=100'),
    api('/users/students'),
    api('/users/teachers'),
    api(`/classes${buildQuery({ ...filter, page: pagination.page, pageSize: pagination.pageSize })}`),
  ]);
  courses.value = coursePage.items;
  students.value = studentList;
  teachers.value = teacherList;
  items.value = page.items;
  pagination.page = page.page;
  pagination.pageSize = page.pageSize;
  pagination.total = page.total;
}

function loadFirstPage() {
  pagination.page = 1;
  return load();
}

function openCreate() {
  editingId.value = '';
  Object.assign(form, baseForm());
  formVisible.value = true;
}

function editClass(row) {
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    courseId: row.courseId || '',
    description: row.description || '',
    status: row.status || 'active',
    sortOrder: row.sortOrder || 0,
  });
  formVisible.value = true;
}

function openBatchCreateStudents() {
  studentBatchVisible.value = true;
}

function openBatchCreateTeachers() {
  teacherBatchVisible.value = true;
}

function openCreateStudent() {
  Object.assign(studentCreateForm, baseStudentCreateForm());
  studentCreateVisible.value = true;
}

function openCreateTeacher() {
  Object.assign(teacherCreateForm, baseUserCreateForm());
  teacherCreateVisible.value = true;
}

async function saveClass() {
  const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));
  await api(editingId.value ? `/classes/${editingId.value}` : '/classes', {
    method: editingId.value ? 'PATCH' : 'POST',
    body,
  });
  ElMessage.success('班级已保存');
  formVisible.value = false;
  await load();
}

async function createStudent() {
  const username = studentCreateForm.username.trim();
  if (!username) {
    ElMessage.warning('请填写学生账号');
    return;
  }

  studentCreateLoading.value = true;
  try {
    const result = await api('/users/students', {
      method: 'POST',
      body: {
        username,
        realName: studentCreateForm.realName.trim() || undefined,
        password: studentCreateForm.password.trim() || undefined,
      },
    });
    students.value = await api('/users/students');

    let addedText = '';
    if (detailVisible.value && detail.value?.id && result.student?.id) {
      await api(`/classes/${detail.value.id}/students`, { method: 'POST', body: { userIds: [result.student.id] } });
      await openDetail(detail.value);
      await load();
      addedText = '，已加入当前班级';
    }

    ElMessage.success(`${result.created ? '学生已创建' : '学生账号已存在'}${addedText}`);
    studentCreateVisible.value = false;
  } finally {
    studentCreateLoading.value = false;
  }
}

async function createTeacher() {
  const username = teacherCreateForm.username.trim();
  if (!username) {
    ElMessage.warning('请填写教师账号');
    return;
  }

  teacherCreateLoading.value = true;
  try {
    const result = await api('/users/teachers', {
      method: 'POST',
      body: {
        username,
        realName: teacherCreateForm.realName.trim() || undefined,
        password: teacherCreateForm.password.trim() || undefined,
      },
    });
    teachers.value = await api('/users/teachers');

    let addedText = '';
    if (detailVisible.value && detail.value?.id && result.teacher?.id) {
      await api(`/classes/${detail.value.id}/teachers`, { method: 'POST', body: { userIds: [result.teacher.id] } });
      await openDetail(detail.value);
      await load();
      addedText = '，已加入当前班级';
    }

    ElMessage.success(`${result.created ? '教师已创建' : '教师账号已存在'}${addedText}`);
    teacherCreateVisible.value = false;
  } finally {
    teacherCreateLoading.value = false;
  }
}

function parseStudentBatchText() {
  return parseBatchText(studentBatchText.value);
}

function parseTeacherBatchText() {
  return parseBatchText(teacherBatchText.value);
}

function parseBatchText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const columns = line.includes(',') || line.includes('，') || line.includes('\t')
        ? line.split(/[,，\t]/)
        : line.split(/\s+/);
      const [username = '', realName = '', password = ''] = columns.map((column) => column.trim());
      const student = {
        username,
        realName,
      };
      if (password) student.password = password;
      return student;
    })
    .filter((item) => item.username);
}

async function createStudentsBatch() {
  const batchStudents = parseStudentBatchText();
  if (!batchStudents.length) {
    ElMessage.warning('请填写学生名单');
    return;
  }

  studentBatchLoading.value = true;
  try {
    const result = await api('/users/students/batch', {
      method: 'POST',
      body: {
        defaultPassword: studentBatchDefaultPassword.value.trim() || undefined,
        students: batchStudents,
      },
    });
    students.value = await api('/users/students');

    let addedCount = 0;
    const availableIds = (result.availableStudents || []).map((student) => student.id).filter(Boolean);
    if (detailVisible.value && detail.value?.id && availableIds.length) {
      await api(`/classes/${detail.value.id}/students`, { method: 'POST', body: { userIds: availableIds } });
      addedCount = availableIds.length;
      await openDetail(detail.value);
      await load();
    }

    const addedText = addedCount ? `，已加入当前班级 ${addedCount} 人` : '';
    ElMessage.success(`已创建 ${result.createdCount} 人，跳过 ${result.skippedCount} 人${addedText}`);
    studentBatchVisible.value = false;
    studentBatchText.value = '';
  } finally {
    studentBatchLoading.value = false;
  }
}

async function createTeachersBatch() {
  const batchTeachers = parseTeacherBatchText();
  if (!batchTeachers.length) {
    ElMessage.warning('请填写教师名单');
    return;
  }

  teacherBatchLoading.value = true;
  try {
    const result = await api('/users/teachers/batch', {
      method: 'POST',
      body: {
        defaultPassword: teacherBatchDefaultPassword.value.trim() || undefined,
        teachers: batchTeachers,
      },
    });
    teachers.value = await api('/users/teachers');

    let addedCount = 0;
    const availableIds = (result.availableTeachers || []).map((teacher) => teacher.id).filter(Boolean);
    if (detailVisible.value && detail.value?.id && availableIds.length) {
      await api(`/classes/${detail.value.id}/teachers`, { method: 'POST', body: { userIds: availableIds } });
      addedCount = availableIds.length;
      await openDetail(detail.value);
      await load();
    }

    const addedText = addedCount ? `，已加入当前班级 ${addedCount} 人` : '';
    ElMessage.success(`已创建 ${result.createdCount} 人，跳过 ${result.skippedCount} 人${addedText}`);
    teacherBatchVisible.value = false;
    teacherBatchText.value = '';
  } finally {
    teacherBatchLoading.value = false;
  }
}

async function openDetail(row) {
  detail.value = await api(`/classes/${row.id}`);
  selectedStudentIds.value = [];
  selectedTeacherIds.value = [];
  detailVisible.value = true;
}

async function addStudents() {
  if (!selectedStudentIds.value.length) return;
  await api(`/classes/${detail.value.id}/students`, { method: 'POST', body: { userIds: selectedStudentIds.value } });
  ElMessage.success('学生已添加');
  await openDetail(detail.value);
  await load();
}

async function addTeachers() {
  if (!selectedTeacherIds.value.length) return;
  await api(`/classes/${detail.value.id}/teachers`, { method: 'POST', body: { userIds: selectedTeacherIds.value } });
  ElMessage.success('教师已添加');
  await openDetail(detail.value);
  await load();
}

async function removeStudent(row) {
  await api(`/classes/${detail.value.id}/students/${row.id}`, { method: 'DELETE' });
  ElMessage.success('学生已移除');
  await openDetail(detail.value);
  await load();
}

async function removeTeacher(row) {
  await api(`/classes/${detail.value.id}/teachers/${row.id}`, { method: 'DELETE' });
  ElMessage.success('教师已移除');
  await openDetail(detail.value);
  await load();
}

async function removeClass(row) {
  await ElMessageBox.confirm(`确认归档班级“${row.name}”？`, '归档班级', { type: 'warning' });
  await api(`/classes/${row.id}`, { method: 'DELETE' });
  ElMessage.success('班级已归档');
  await load();
}

function handleCommand(row, command) {
  if (command === 'edit') editClass(row);
  if (command === 'members') openDetail(row);
  if (command === 'remove') removeClass(row).catch(() => {});
}

function handleSort({ prop, order }) {
  filter.sortBy = prop || 'sortOrder';
  filter.sortOrder = order === 'ascending' ? 'asc' : 'desc';
  loadFirstPage();
}

function handleSize(size) {
  pagination.pageSize = size;
  pagination.page = 1;
  load();
}

function handleCurrent(page) {
  pagination.page = page;
  load();
}

function statusLabel(status) {
  const map = { active: '启用', disabled: '停用', archived: '归档' };
  return map[status] ?? status;
}

onMounted(load);
</script>
