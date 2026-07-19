import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute } from 'vue-router';
import { getCurrentUser } from '../../../api';
import { hasAnyPermission } from '../../../access';
import {
  adjustHours,
  cancelSession,
  confirmAttendance,
  correctAttendance,
  createCourseUnit,
  createLessonType,
  createMakeupSession,
  createRule,
  createSession,
  generateSessions,
  getAttendance,
  listBalances,
  listClasses,
  listCourseUnits,
  listLedger,
  listLessonTypes,
  listRules,
  listSessions,
  reconcileHours,
  rescheduleSession,
  type AcademicOperationRecord,
} from '../api';

export function useAcademicOperations() {
  const route = useRoute();
  const user = getCurrentUser();
  const canManageCatalog = hasAnyPermission(user, ['lesson-type:manage', 'course-unit:manage']);
  const canManageSchedule = hasAnyPermission(user, ['schedule:manage']);
  const canConfirmAttendance = hasAnyPermission(user, ['attendance:confirm']);
  const canCorrectAttendance = hasAnyPermission(user, ['attendance:correct']);
  const canAdjustHours = hasAnyPermission(user, ['lesson-hour:adjust']);
  const canReconcile = hasAnyPermission(user, ['lesson-hour:reconcile']);
  const canManageLessonRecords = hasAnyPermission(user, ['lesson-record:manage']);
  const canReadClasses = hasAnyPermission(user, ['class:read']);

  const activeTab = ref(academicTab(route.query.tab));
  const loading = ref(false);
  const classes = ref<AcademicOperationRecord[]>([]);
  const lessonTypes = ref<AcademicOperationRecord[]>([]);
  const units = ref<AcademicOperationRecord[]>([]);
  const rules = ref<AcademicOperationRecord[]>([]);
  const sessions = ref<AcademicOperationRecord[]>([]);
  const balances = ref<AcademicOperationRecord[]>([]);
  const ledger = ref<AcademicOperationRecord[]>([]);
  const attendance = ref<AcademicOperationRecord | null>(null);
  const selectedSessionId = ref('');
  const selectedClassId = ref('');
  const dateRange = ref(defaultDateRange());
  const reconciliation = ref<AcademicOperationRecord | null>(null);

  const ruleVisible = ref(false);
  const generateVisible = ref(false);
  const sessionVisible = ref(false);
  const sessionChangeVisible = ref(false);
  const sessionChangeMode = ref<'reschedule' | 'makeup'>('reschedule');
  const sessionChangeSource = ref<AcademicOperationRecord | null>(null);
  const lessonTypeVisible = ref(false);
  const unitVisible = ref(false);
  const adjustmentVisible = ref(false);
  const correctionVisible = ref(false);
  const saving = ref(false);

  const ruleForm = reactive(baseRuleForm());
  const generateForm = reactive({ ruleId: '', classId: '', from: dateRange.value[0], to: dateRange.value[1] });
  const sessionForm = reactive(baseSessionForm());
  const sessionChangeForm = reactive(baseSessionChangeForm());
  const lessonTypeForm = reactive({ name: '', defaultHours: 1, countInStatistics: true, active: true, description: '' });
  const unitForm = reactive({ code: '', lessonTypeId: '', category: '', stage: '', unitNo: 1, name: '', defaultHours: 1, teachingContent: '' });
  const adjustmentForm = reactive({ studentId: '', type: 'PURCHASE', amount: 1, note: '' });
  const correctionForm = reactive({ id: '', status: 'LEAVE', deductHours: 0, reason: '' });

  const selectedSession = computed(() => sessions.value.find((item) => item.id === selectedSessionId.value));

  async function load() {
    loading.value = true;
    try {
      const [sessionPage, balanceRows, ledgerPage] = await Promise.all([
        listSessions(sessionParams()),
        listBalances(selectedClassId.value ? { classId: selectedClassId.value } : {}),
        listLedger(selectedClassId.value ? { classId: selectedClassId.value } : {}),
      ]);
      sessions.value = sessionPage.items ?? [];
      balances.value = balanceRows;
      ledger.value = ledgerPage.items ?? [];

      if (canReadClasses) {
        const classPage = await listClasses();
        classes.value = classPage.items ?? [];
      }
      if (canManageSchedule || canManageCatalog) {
        const [typePage, unitPage, rulePage] = await Promise.all([
          listLessonTypes(), listCourseUnits(), listRules(selectedClassId.value || undefined),
        ]);
        lessonTypes.value = typePage.items ?? [];
        units.value = unitPage.items ?? [];
        rules.value = rulePage.items ?? [];
      }
      if (selectedSessionId.value && sessions.value.some((item) => item.id === selectedSessionId.value)) {
        await loadAttendance();
      }
    } finally {
      loading.value = false;
    }
  }

  async function loadAttendance() {
    if (!selectedSessionId.value) {
      attendance.value = null;
      return;
    }
    const detail = await getAttendance(selectedSessionId.value);
    detail.records = (detail.records ?? []).map((item: AcademicOperationRecord) => ({
      ...item,
      draftStatus: item.status,
      draftDeductHours: item.confirmedAt ? item.deductHours : detail.session.lessonHours,
    }));
    attendance.value = detail;
  }

  async function openAttendance(session: AcademicOperationRecord) {
    selectedSessionId.value = session.id;
    activeTab.value = 'attendance';
    await loadAttendance();
  }

  async function submitAttendance() {
    if (!attendance.value) return;
    const records = attendance.value.records
      .filter((item: AcademicOperationRecord) => !item.confirmedAt && item.draftStatus !== 'UNCONFIRMED')
      .map((item: AcademicOperationRecord) => ({
        studentId: item.studentId,
        status: item.draftStatus,
        deductHours: Number(item.draftDeductHours ?? 0),
      }));
    if (!records.length) {
      ElMessage.warning('请选择至少一条尚未确认的考勤');
      return;
    }
    saving.value = true;
    try {
      const result = await confirmAttendance(selectedSessionId.value, { records });
      ElMessage.success(`已确认 ${result.confirmed} 条，幂等跳过 ${result.skipped} 条`);
      await Promise.all([loadAttendance(), loadHours()]);
    } finally {
      saving.value = false;
    }
  }

  function openCorrection(row: AcademicOperationRecord) {
    Object.assign(correctionForm, {
      id: row.id,
      status: row.status,
      deductHours: row.deductHours,
      reason: '',
    });
    correctionVisible.value = true;
  }

  async function submitCorrection() {
    if (!correctionForm.reason.trim()) {
      ElMessage.warning('请填写更正原因');
      return;
    }
    await ElMessageBox.confirm('更正会追加冲正台账，不会覆盖历史记录。确认继续？', '确认更正', { type: 'warning' });
    await correctAttendance(correctionForm.id, {
      status: correctionForm.status,
      deductHours: Number(correctionForm.deductHours),
      reason: correctionForm.reason.trim(),
    });
    correctionVisible.value = false;
    ElMessage.success('考勤已更正，冲正台账已追加');
    await Promise.all([loadAttendance(), loadHours()]);
  }

  function openRule() {
    Object.assign(ruleForm, baseRuleForm(), { classId: selectedClassId.value });
    ruleVisible.value = true;
  }

  async function submitRule() {
    if (!ruleForm.classId || !ruleForm.lessonTypeId || !ruleForm.startTime || !ruleForm.endTime) {
      ElMessage.warning('请完整填写班级、课型和时间');
      return;
    }
    await createRule({
      classId: ruleForm.classId,
      lessonTypeId: ruleForm.lessonTypeId,
      unitTemplateId: ruleForm.unitTemplateId || undefined,
      weekday: Number(ruleForm.weekday),
      startMinute: minuteOfDay(ruleForm.startTime),
      endMinute: minuteOfDay(ruleForm.endTime),
      effectiveFrom: ruleForm.effectiveFrom,
      effectiveTo: ruleForm.effectiveTo || undefined,
      timezone: 'Asia/Shanghai',
      lessonHours: Number(ruleForm.lessonHours),
      classroom: compact(ruleForm.classroom),
    });
    ruleVisible.value = false;
    ElMessage.success('排课规则已保存');
    await load();
  }

  function openGenerate() {
    Object.assign(generateForm, {
      ruleId: '', classId: selectedClassId.value, from: dateRange.value[0], to: dateRange.value[1],
    });
    generateVisible.value = true;
  }

  async function submitGenerate() {
    const result = await generateSessions({
      ruleId: generateForm.ruleId || undefined,
      classId: generateForm.classId || undefined,
      from: generateForm.from,
      to: generateForm.to,
    });
    generateVisible.value = false;
    ElMessage.success(`生成 ${result.created} 节，跳过重复 ${result.skipped} 节`);
    await load();
  }

  function openSession() {
    Object.assign(sessionForm, baseSessionForm(), { classId: selectedClassId.value });
    sessionVisible.value = true;
  }

  async function submitSession() {
    if (!sessionForm.classId || !sessionForm.lessonTypeId || !sessionForm.startsAt || !sessionForm.endsAt) {
      ElMessage.warning('请完整填写临时课次');
      return;
    }
    await createSession({
      classId: sessionForm.classId,
      lessonTypeId: sessionForm.lessonTypeId,
      unitTemplateId: sessionForm.unitTemplateId || undefined,
      title: sessionForm.title.trim(),
      kind: 'TEMPORARY',
      startsAt: new Date(sessionForm.startsAt).toISOString(),
      endsAt: new Date(sessionForm.endsAt).toISOString(),
      timezone: 'Asia/Shanghai',
      lessonHours: Number(sessionForm.lessonHours),
      classroom: compact(sessionForm.classroom),
    });
    sessionVisible.value = false;
    ElMessage.success('临时课次已创建');
    await load();
  }

  function openSessionChange(row: AcademicOperationRecord, mode: 'reschedule' | 'makeup') {
    sessionChangeMode.value = mode;
    sessionChangeSource.value = row;
    const offset = mode === 'makeup' ? 7 * 24 * 60 * 60 * 1_000 : 0;
    Object.assign(sessionChangeForm, {
      startsAt: new Date(new Date(row.startsAt).getTime() + offset).toISOString(),
      endsAt: new Date(new Date(row.endsAt).getTime() + offset).toISOString(),
      classroom: row.classroom ?? '',
      reason: '',
    });
    sessionChangeVisible.value = true;
  }

  async function submitSessionChange() {
    const source = sessionChangeSource.value;
    if (!source || !sessionChangeForm.startsAt || !sessionChangeForm.endsAt || !sessionChangeForm.reason.trim()) {
      ElMessage.warning('请完整填写变更时间和原因');
      return;
    }
    const body = {
      startsAt: new Date(sessionChangeForm.startsAt).toISOString(),
      endsAt: new Date(sessionChangeForm.endsAt).toISOString(),
      classroom: compact(sessionChangeForm.classroom),
      reason: sessionChangeForm.reason.trim(),
    };
    saving.value = true;
    try {
      if (sessionChangeMode.value === 'reschedule') await rescheduleSession(source.id, body);
      else await createMakeupSession(source.id, body);
      sessionChangeVisible.value = false;
      ElMessage.success(sessionChangeMode.value === 'reschedule' ? '调课完成，原课次已保留追溯记录' : '补课课次已创建');
      await load();
    } finally {
      saving.value = false;
    }
  }

  async function cancelScheduledSession(row: AcademicOperationRecord) {
    const result = await ElMessageBox.prompt('取消后原课次仍会保留，便于审计和后续补课。', '取消课次', {
      confirmButtonText: '确认取消',
      cancelButtonText: '返回',
      inputPlaceholder: '填写取消原因',
      inputValidator: (value) => Boolean(value?.trim()) || '请填写取消原因',
      type: 'warning',
    });
    await cancelSession(row.id, { reason: result.value.trim() });
    ElMessage.success('课次已取消，可从原记录创建补课');
    await load();
  }

  function openLessonType() {
    Object.assign(lessonTypeForm, { name: '', defaultHours: 1, countInStatistics: true, active: true, description: '' });
    lessonTypeVisible.value = true;
  }

  async function submitLessonType() {
    await createLessonType({ ...lessonTypeForm, name: lessonTypeForm.name.trim(), description: compact(lessonTypeForm.description) });
    lessonTypeVisible.value = false;
    ElMessage.success('课型已创建');
    await load();
  }

  function openUnit() {
    Object.assign(unitForm, { code: '', lessonTypeId: '', category: '', stage: '', unitNo: 1, name: '', defaultHours: 1, teachingContent: '' });
    unitVisible.value = true;
  }

  async function submitUnit() {
    await createCourseUnit({
      ...unitForm,
      code: unitForm.code.trim(),
      name: unitForm.name.trim(),
      category: compact(unitForm.category),
      stage: compact(unitForm.stage),
      teachingContent: compact(unitForm.teachingContent),
      status: 'ACTIVE',
    });
    unitVisible.value = false;
    ElMessage.success('课程单元已创建');
    await load();
  }

  function openAdjustment(row?: AcademicOperationRecord) {
    Object.assign(adjustmentForm, { studentId: row?.studentId ?? '', type: 'PURCHASE', amount: 1, note: '' });
    adjustmentVisible.value = true;
  }

  async function submitAdjustment() {
    if (!adjustmentForm.studentId) {
      ElMessage.warning('请选择学生');
      return;
    }
    await adjustHours({
      studentId: adjustmentForm.studentId,
      classId: selectedClassId.value || undefined,
      type: adjustmentForm.type,
      amount: Number(adjustmentForm.amount),
      idempotencyKey: `ui:${crypto.randomUUID()}`,
      note: compact(adjustmentForm.note),
    });
    adjustmentVisible.value = false;
    ElMessage.success('课时变动已记入不可变台账');
    await loadHours();
  }

  async function runReconciliation() {
    reconciliation.value = await reconcileHours({});
    if (reconciliation.value.passed) ElMessage.success('课时全量重算通过');
    else ElMessage.error('课时核对存在差异，请查看报告');
  }

  async function loadHours() {
    const params = selectedClassId.value ? { classId: selectedClassId.value } : {};
    const [balanceRows, ledgerPage] = await Promise.all([listBalances(params), listLedger(params)]);
    balances.value = balanceRows;
    ledger.value = ledgerPage.items ?? [];
  }

  function sessionParams() {
    const [from, to] = dateRange.value;
    return {
      classId: selectedClassId.value || undefined,
      from: from ? `${from}T00:00:00+08:00` : undefined,
      to: to ? `${to}T23:59:59+08:00` : undefined,
    };
  }

  onMounted(load);
  return {
    activeTab, adjustmentForm, adjustmentVisible, attendance, balances, canAdjustHours,
    canConfirmAttendance, canCorrectAttendance, canManageCatalog, canManageLessonRecords, canManageSchedule, canReconcile,
    cancelScheduledSession, classes, correctionForm, correctionVisible, dateRange, generateForm, generateVisible,
    ledger, lessonTypeForm, lessonTypeVisible, lessonTypes, loading, openAdjustment,
    openAttendance, openCorrection, openGenerate, openLessonType, openRule, openSession, openSessionChange, openUnit,
    reconciliation, ruleForm, ruleVisible, rules, saving, selectedClassId, selectedSession,
    selectedSessionId, sessionChangeForm, sessionChangeMode, sessionChangeSource, sessionChangeVisible,
    sessionForm, sessionVisible, sessions, submitAdjustment, submitAttendance,
    submitCorrection, submitGenerate, submitLessonType, submitRule, submitSession, submitSessionChange, submitUnit,
    unitForm, unitVisible, units, load, loadAttendance, runReconciliation,
  };
}

function academicTab(value: unknown) {
  const requested = Array.isArray(value) ? value[0] : value;
  const key = typeof requested === 'string' ? requested : 'schedule';
  return ({ schedule: 'calendar', calendar: 'calendar', attendance: 'attendance', ledger: 'ledger', catalog: 'catalog' } as Record<string, string>)[key] ?? 'calendar';
}

function baseRuleForm() {
  const [from, to] = defaultDateRange();
  return {
    classId: '', lessonTypeId: '', unitTemplateId: '', weekday: 1, startTime: '18:00', endTime: '20:00',
    effectiveFrom: from, effectiveTo: to, lessonHours: 1, classroom: '',
  };
}

function baseSessionForm() {
  return {
    classId: '', lessonTypeId: '', unitTemplateId: '', title: '', startsAt: '', endsAt: '', lessonHours: 1, classroom: '',
  };
}

function baseSessionChangeForm() {
  return { startsAt: '', endsAt: '', classroom: '', reason: '' };
}

function defaultDateRange() {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 30);
  return [dateOnly(from), dateOnly(to)];
}

function dateOnly(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function minuteOfDay(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function compact(value: string) {
  return value.trim() || undefined;
}
