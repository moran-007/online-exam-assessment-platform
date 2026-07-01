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
          <el-select v-model="selectedStudentIds" multiple filterable placeholder="添加学生">
            <el-option
              v-for="student in students"
              :key="student.id"
              :label="student.realName ? `${student.realName}（${student.username}）` : student.username"
              :value="student.id"
            />
          </el-select>
          <el-button :icon="Plus" @click="addStudents">添加学生</el-button>
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
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api, buildQuery } from '../api';

const filter = reactive({ keyword: '', courseId: '', status: '', sortBy: 'sortOrder', sortOrder: 'asc' });
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
const form = reactive(baseForm());
const items = ref([]);
const courses = ref([]);
const students = ref([]);
const teachers = ref([]);
const detail = ref(null);
const editingId = ref('');
const formVisible = ref(false);
const detailVisible = ref(false);
const selectedStudentIds = ref([]);
const selectedTeacherIds = ref([]);

function baseForm() {
  return { name: '', courseId: '', description: '', status: 'active', sortOrder: 0 };
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
