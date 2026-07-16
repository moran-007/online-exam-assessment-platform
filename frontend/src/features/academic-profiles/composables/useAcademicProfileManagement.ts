import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  approveMigrationRun,
  getMigrationRun,
  linkParentStudent,
  listMigrationRuns,
  listParentProfiles,
  listStudentProfiles,
  listTeacherProfiles,
  resolveMigrationConflict,
  unlinkParentStudent,
  updateStudentProfile,
  updateTeacherProfile,
  type AcademicRecord,
} from '../api';

export function useAcademicProfileManagement() {
  const activeTab = ref('students');
  const keyword = ref('');
  const loading = ref(false);
  const students = ref<AcademicRecord[]>([]);
  const teachers = ref<AcademicRecord[]>([]);
  const parents = ref<AcademicRecord[]>([]);
  const migrationRuns = ref<AcademicRecord[]>([]);
  const profileVisible = ref(false);
  const profileType = ref<'student' | 'teacher'>('student');
  const editing = ref<AcademicRecord | null>(null);
  const saving = ref(false);
  const profileForm = reactive(baseProfileForm());
  const parentVisible = ref(false);
  const parentForm = reactive({ parentId: '', studentId: '', relationship: '监护人', isPrimary: false });
  const migrationVisible = ref(false);
  const migrationDetail = ref<AcademicRecord | null>(null);

  async function load() {
    loading.value = true;
    try {
      const [studentRows, teacherRows, parentRows, runs] = await Promise.all([
        listStudentProfiles(keyword.value.trim() || undefined),
        listTeacherProfiles(keyword.value.trim() || undefined),
        listParentProfiles(keyword.value.trim() || undefined),
        listMigrationRuns(),
      ]);
      students.value = studentRows;
      teachers.value = teacherRows;
      parents.value = parentRows;
      migrationRuns.value = runs;
    } finally {
      loading.value = false;
    }
  }

  function openStudent(row: AcademicRecord) {
    profileType.value = 'student';
    editing.value = row;
    Object.assign(profileForm, baseProfileForm(), {
      studentNo: row.studentProfile?.studentNo || '',
      gender: row.studentProfile?.gender || '',
      school: row.studentProfile?.school || '',
      grade: row.studentProfile?.grade || '',
      status: row.studentProfile?.enrollmentStatus || 'active',
      date: dateOnly(row.studentProfile?.enrolledAt),
      notes: row.studentProfile?.notes || '',
    });
    profileVisible.value = true;
  }

  function openTeacher(row: AcademicRecord) {
    profileType.value = 'teacher';
    editing.value = row;
    Object.assign(profileForm, baseProfileForm(), {
      employeeNo: row.teacherProfile?.employeeNo || '',
      subject: row.teacherProfile?.subject || '',
      status: row.teacherProfile?.employmentStatus || 'active',
      date: dateOnly(row.teacherProfile?.joinedAt),
      notes: row.teacherProfile?.notes || '',
    });
    profileVisible.value = true;
  }

  async function saveProfile() {
    if (!editing.value) return;
    saving.value = true;
    try {
      const compact = (value: string) => value.trim() || undefined;
      if (profileType.value === 'student') {
        await updateStudentProfile(editing.value.id, {
          studentNo: compact(profileForm.studentNo),
          gender: compact(profileForm.gender),
          school: compact(profileForm.school),
          grade: compact(profileForm.grade),
          enrollmentStatus: profileForm.status,
          enrolledAt: profileForm.date || undefined,
          notes: compact(profileForm.notes),
        });
      } else {
        await updateTeacherProfile(editing.value.id, {
          employeeNo: compact(profileForm.employeeNo),
          subject: compact(profileForm.subject),
          employmentStatus: profileForm.status,
          joinedAt: profileForm.date || undefined,
          notes: compact(profileForm.notes),
        });
      }
      profileVisible.value = false;
      ElMessage.success('档案已保存');
      await load();
    } finally {
      saving.value = false;
    }
  }

  function openParentLink(parent?: AcademicRecord, student?: AcademicRecord) {
    Object.assign(parentForm, {
      parentId: parent?.id || '',
      studentId: student?.id || '',
      relationship: '监护人',
      isPrimary: false,
    });
    parentVisible.value = true;
  }

  async function saveParentLink() {
    if (!parentForm.parentId || !parentForm.studentId || !parentForm.relationship.trim()) {
      ElMessage.warning('请选择家长、学生并填写关系');
      return;
    }
    await linkParentStudent({ ...parentForm, relationship: parentForm.relationship.trim() });
    parentVisible.value = false;
    ElMessage.success('家长关系已保存');
    await load();
  }

  async function unlink(parent: AcademicRecord, student: AcademicRecord) {
    await ElMessageBox.confirm(
      `确认解除“${parent.realName || parent.username}”与“${student.realName || student.username}”的关系？`,
      '解除家长关系',
      { type: 'warning' },
    );
    await unlinkParentStudent(parent.id, student.id);
    ElMessage.success('家长关系已解除，历史记录仍保留');
    await load();
  }

  async function openMigration(row: AcademicRecord) {
    migrationDetail.value = await getMigrationRun(row.id);
    migrationVisible.value = true;
  }

  async function resolveConflict(conflict: AcademicRecord) {
    const phoneConflict = String(conflict.conflictType).includes('PHONE');
    const code = phoneConflict ? 'CREATE_WITHOUT_PHONE' : 'SKIP';
    const action = phoneConflict ? '保留独立档案，但不迁移冲突手机号' : '跳过该冲突对象';
    const { value: note } = await ElMessageBox.prompt(
      `${action}。请输入处置依据；系统不会按姓名自动合并。`,
      '处置身份冲突',
      { inputPlaceholder: '处置依据（必填）', inputValidator: (value) => Boolean(value?.trim()) || '请填写处置依据' },
    );
    migrationDetail.value = await resolveMigrationConflict(conflict.id, {
      resolutionCode: code,
      note: note.trim(),
      waive: false,
    });
    await loadMigrationRows();
    ElMessage.success('冲突已处置并记录责任人');
  }

  async function approveMigration() {
    if (!migrationDetail.value) return;
    await ElMessageBox.confirm(
      '批准后才允许使用同一指纹的源快照导入。确认身份冲突均已核验？',
      '批准档案迁移',
      { type: 'warning', confirmButtonText: '确认批准' },
    );
    migrationDetail.value = await approveMigrationRun(migrationDetail.value.id);
    await loadMigrationRows();
    ElMessage.success('迁移演练已批准');
  }

  async function loadMigrationRows() {
    migrationRuns.value = await listMigrationRuns();
  }

  function profileStatus(row: AcademicRecord, type: 'student' | 'teacher') {
    return type === 'student'
      ? row.studentProfile?.enrollmentStatus || '未建档'
      : row.teacherProfile?.employmentStatus || '未建档';
  }

  onMounted(load);
  return {
    activeTab, approveMigration, editing, keyword, load, loading, migrationDetail, migrationRuns,
    migrationVisible, openMigration, openParentLink, openStudent, openTeacher, parentForm,
    parentVisible, parents, profileForm, profileStatus, profileType, profileVisible, resolveConflict,
    saveParentLink, saveProfile, saving, students, teachers, unlink,
  };
}

function baseProfileForm() {
  return {
    studentNo: '', gender: '', school: '', grade: '', employeeNo: '', subject: '',
    status: 'active', date: '', notes: '',
  };
}

function dateOnly(value?: string) {
  return value ? String(value).slice(0, 10) : '';
}
