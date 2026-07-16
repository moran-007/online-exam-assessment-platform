import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getCurrentUser } from '../../../api';
import {
  addClassStudents,
  addClassTeachers,
  batchCreateStudents,
  batchCreateTeachers,
  createClass,
  createStudent as createStudentRequest,
  createTeacher as createTeacherRequest,
  getClass,
  listClasses,
  listCourses,
  listStudents,
  listTeachers,
  removeClass as removeClassRequest,
  removeClassStudent,
  removeClassTeacher,
  updateClass,
} from '../../platform/api';

const CLASS_STATUS_LABELS = { active: '启用', disabled: '停用', archived: '归档' };

export function useClassManagementPage() {
  const filter = reactive({ keyword: '', courseId: '', status: '', sortBy: 'sortOrder', sortOrder: 'asc' });
  const pagination = reactive({ page: 1, pageSize: 20, total: 0 });
  const form = reactive(baseClassForm());
  const studentCreateForm = reactive(baseUserForm());
  const teacherCreateForm = reactive(baseUserForm());
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

  async function load() {
    const [coursePage, studentList, teacherList, page] = await Promise.all([
      listCourses({ pageSize: 100 }),
      listStudents(),
      listTeachers(),
      listClasses({ ...filter, page: pagination.page, pageSize: pagination.pageSize }),
    ]);
    courses.value = coursePage.items;
    students.value = studentList;
    teachers.value = teacherList;
    items.value = page.items;
    Object.assign(pagination, { page: page.page, pageSize: page.pageSize, total: page.total });
  }

  function loadFirstPage() {
    pagination.page = 1;
    return load();
  }

  function openCreate() {
    editingId.value = '';
    Object.assign(form, baseClassForm());
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

  function openCreateStudent() {
    Object.assign(studentCreateForm, baseUserForm());
    studentCreateVisible.value = true;
  }

  function openCreateTeacher() {
    Object.assign(teacherCreateForm, baseUserForm());
    teacherCreateVisible.value = true;
  }

  async function saveClass() {
    const body = Object.fromEntries(Object.entries(form).filter(([, value]) => value !== ''));
    await (editingId.value ? updateClass(editingId.value, body) : createClass(body));
    ElMessage.success('班级已保存');
    formVisible.value = false;
    await load();
  }

  async function createStudent() {
    await createUser({
      form: studentCreateForm,
      loading: studentCreateLoading,
      visible: studentCreateVisible,
      request: createStudentRequest,
      refreshUsers: async () => { students.value = await listStudents(); },
      addToClass: addClassStudents,
      resultKey: 'student',
      label: '学生',
    });
  }

  async function createTeacher() {
    await createUser({
      form: teacherCreateForm,
      loading: teacherCreateLoading,
      visible: teacherCreateVisible,
      request: createTeacherRequest,
      refreshUsers: async () => { teachers.value = await listTeachers(); },
      addToClass: addClassTeachers,
      resultKey: 'teacher',
      label: '教师',
    });
  }

  async function createUser(options) {
    const username = options.form.username.trim();
    if (!username) {
      ElMessage.warning(`请填写${options.label}账号`);
      return;
    }
    options.loading.value = true;
    try {
      const result = await options.request({
        username,
        realName: options.form.realName.trim() || undefined,
        password: options.form.password.trim() || undefined,
      });
      await options.refreshUsers();
      const createdUser = result[options.resultKey];
      let addedText = '';
      if (detailVisible.value && detail.value?.id && createdUser?.id) {
        await options.addToClass(detail.value.id, { userIds: [createdUser.id] });
        await refreshDetail();
        addedText = '，已加入当前班级';
      }
      ElMessage.success(`${result.created ? `${options.label}已创建` : `${options.label}账号已存在`}${addedText}`);
      options.visible.value = false;
    } finally {
      options.loading.value = false;
    }
  }

  async function createStudentsBatch() {
    await createUsersBatch({
      text: studentBatchText,
      defaultPassword: studentBatchDefaultPassword,
      loading: studentBatchLoading,
      visible: studentBatchVisible,
      request: batchCreateStudents,
      refreshUsers: async () => { students.value = await listStudents(); },
      addToClass: addClassStudents,
      resultKey: 'availableStudents',
      bodyKey: 'students',
      label: '学生',
    });
  }

  async function createTeachersBatch() {
    await createUsersBatch({
      text: teacherBatchText,
      defaultPassword: teacherBatchDefaultPassword,
      loading: teacherBatchLoading,
      visible: teacherBatchVisible,
      request: batchCreateTeachers,
      refreshUsers: async () => { teachers.value = await listTeachers(); },
      addToClass: addClassTeachers,
      resultKey: 'availableTeachers',
      bodyKey: 'teachers',
      label: '教师',
    });
  }

  async function createUsersBatch(options) {
    const users = parseBatchText(options.text.value);
    if (!users.length) {
      ElMessage.warning(`请填写${options.label}名单`);
      return;
    }
    options.loading.value = true;
    try {
      const result = await options.request({
        defaultPassword: options.defaultPassword.value.trim() || undefined,
        [options.bodyKey]: users,
      });
      await options.refreshUsers();
      const availableIds = (result[options.resultKey] || []).map((user) => user.id).filter(Boolean);
      let addedCount = 0;
      if (detailVisible.value && detail.value?.id && availableIds.length) {
        await options.addToClass(detail.value.id, { userIds: availableIds });
        addedCount = availableIds.length;
        await refreshDetail();
      }
      const addedText = addedCount ? `，已加入当前班级 ${addedCount} 人` : '';
      ElMessage.success(`已创建 ${result.createdCount} 人，跳过 ${result.skippedCount} 人${addedText}`);
      options.visible.value = false;
      options.text.value = '';
    } finally {
      options.loading.value = false;
    }
  }

  async function openDetail(row) {
    detail.value = await getClass(row.id);
    selectedStudentIds.value = [];
    selectedTeacherIds.value = [];
    detailVisible.value = true;
  }

  async function refreshDetail() {
    await openDetail(detail.value);
    await load();
  }

  async function addStudents() {
    if (!selectedStudentIds.value.length) return;
    await addClassStudents(detail.value.id, { userIds: selectedStudentIds.value });
    ElMessage.success('学生已添加');
    await refreshDetail();
  }

  async function addTeachers() {
    if (!selectedTeacherIds.value.length) return;
    await addClassTeachers(detail.value.id, { userIds: selectedTeacherIds.value });
    ElMessage.success('教师已添加');
    await refreshDetail();
  }

  async function removeStudent(row) {
    await removeClassStudent(detail.value.id, row.id);
    ElMessage.success('学生已移除');
    await refreshDetail();
  }

  async function removeTeacher(row) {
    await removeClassTeacher(detail.value.id, row.id);
    ElMessage.success('教师已移除');
    await refreshDetail();
  }

  async function removeClass(row) {
    await ElMessageBox.confirm(`确认归档班级“${row.name}”？`, '归档班级', { type: 'warning' });
    await removeClassRequest(row.id);
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

  onMounted(load);

  return {
    addStudents, addTeachers, canCreateStudents, canCreateTeachers, courses, createStudent,
    createStudentsBatch, createTeacher, createTeachersBatch, detail, detailVisible, editingId,
    filter, form, formVisible, handleCommand, handleCurrent, handleSize, handleSort, items, load,
    loadFirstPage, openBatchCreateStudents: () => { studentBatchVisible.value = true; },
    openBatchCreateTeachers: () => { teacherBatchVisible.value = true; }, openCreate,
    openCreateStudent, openCreateTeacher, openDetail, pagination, removeStudent, removeTeacher,
    saveClass, selectedStudentIds, selectedTeacherIds, statusLabel, studentBatchDefaultPassword,
    studentBatchLoading, studentBatchText, studentBatchVisible, studentCreateForm,
    studentCreateLoading, studentCreateVisible, students, teacherBatchDefaultPassword,
    teacherBatchLoading, teacherBatchText, teacherBatchVisible, teacherCreateForm,
    teacherCreateLoading, teacherCreateVisible, teachers,
  };
}

function baseClassForm() {
  return { name: '', courseId: '', description: '', status: 'active', sortOrder: 0 };
}

function baseUserForm() {
  return { username: '', realName: '', password: '' };
}

function parseBatchText(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const columns = line.includes(',') || line.includes('，') || line.includes('\t')
      ? line.split(/[,，\t]/)
      : line.split(/\s+/);
    const [username = '', realName = '', password = ''] = columns.map((column) => column.trim());
    return { username, realName, ...(password ? { password } : {}) };
  }).filter((item) => item.username);
}

function statusLabel(status) {
  return CLASS_STATUS_LABELS[status] ?? status;
}
