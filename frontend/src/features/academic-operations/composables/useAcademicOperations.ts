import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRoute } from 'vue-router';
import { getCurrentUser } from '../../../api';
import { hasAnyPermission } from '../../../access';
import {
  cancelSession,
  confirmAttendance,
  correctAttendance,
  createMakeupSession,
  createRule,
  createSession,
  generateSessions,
  getAttendance,
  getScheduleContext,
  listBalances,
  listClasses,
  listLedger,
  listLessonTypes,
  listRules,
  listSessions,
  reconcileHours,
  rescheduleSession,
  updateRule,
  type AcademicOperationRecord,
} from '../api';
import {
  academicTab,
  baseRuleForm,
  baseSessionChangeForm,
  baseSessionForm,
  clockOfMinute,
  compact,
  dateOnlyValue,
  defaultDateRange,
  isBillableAttendance,
  minuteOfDay,
} from './academicOperationsHelpers';
import { useAcademicOperationCatalog } from './useAcademicOperationCatalog';

export function useAcademicOperations() {
  const route = useRoute();
  const user = getCurrentUser();
  const canReadSchedule = hasAnyPermission(user, ['schedule:read']);
  const canReadAttendance = canReadSchedule && hasAnyPermission(user, ['attendance:read']);
  const canReadLessonHours = hasAnyPermission(user, ['lesson-hour:read']);
  const canReadLessonTypes = hasAnyPermission(user, ['lesson-type:read']);
  const canManageLessonTypes = hasAnyPermission(user, ['lesson-type:manage']);
  const canReadCatalog = canReadLessonTypes;
  const canManageSchedule = hasAnyPermission(user, ['schedule:manage']);
  const canConfirmAttendance = hasAnyPermission(user, ['attendance:confirm']);
  const canCorrectAttendance = hasAnyPermission(user, ['attendance:correct']);
  const canAdjustHours = hasAnyPermission(user, ['lesson-hour:adjust']);
  const canReconcile = hasAnyPermission(user, ['lesson-hour:reconcile']);
  const canManageLessonRecords = hasAnyPermission(user, ['lesson-record:manage']);
  const canReadClasses = hasAnyPermission(user, ['class:read']);

  const activeTab = ref(academicTab(route.query.tab, {
    canReadSchedule, canReadAttendance, canReadLessonHours, canReadCatalog,
  }));
  const loading = ref(false);
  const classes = ref<AcademicOperationRecord[]>([]);
  const lessonTypes = ref<AcademicOperationRecord[]>([]);
  const rules = ref<AcademicOperationRecord[]>([]);
  const sessions = ref<AcademicOperationRecord[]>([]);
  const balances = ref<AcademicOperationRecord[]>([]);
  const ledger = ref<AcademicOperationRecord[]>([]);
  const attendance = ref<AcademicOperationRecord | null>(null);
  const selectedSessionId = ref('');
  const selectedClassId = ref('');
  const dateRange = ref(defaultDateRange());
  const reconciliation = ref<AcademicOperationRecord | null>(null);
  const scheduleContext = ref<AcademicOperationRecord | null>(null);
  const scheduleContextCache = new Map<string, AcademicOperationRecord>();

  const ruleVisible = ref(false);
  const generateVisible = ref(false);
  const sessionVisible = ref(false);
  const sessionChangeVisible = ref(false);
  const sessionChangeMode = ref<'reschedule' | 'makeup'>('reschedule');
  const sessionChangeSource = ref<AcademicOperationRecord | null>(null);
  const ruleEditingId = ref('');
  const correctionVisible = ref(false);
  const saving = ref(false);

  const ruleForm = reactive(baseRuleForm());
  const generateForm = reactive({
    ruleId: '',
    from: dateRange.value[0],
    to: dateRange.value[1],
    startKnowledgePointId: '',
    sessionCount: 3,
  });
  const sessionForm = reactive(baseSessionForm());
  const sessionChangeForm = reactive(baseSessionChangeForm());
  const correctionForm = reactive({ id: '', status: 'LEAVE', deductHours: 0, reason: '' });
  const {
    adjustmentForm, adjustmentVisible, lessonTypeEditingId, lessonTypeForm, lessonTypeVisible,
    openAdjustment, openLessonType, submitAdjustment, submitLessonType,
  } = useAcademicOperationCatalog(selectedClassId, load, loadHours);

  const selectedSession = computed(() => sessions.value.find((item) => item.id === selectedSessionId.value));
  const scheduleCourse = computed(() => scheduleContext.value?.course ?? null);
  const scheduleTeachers = computed(() => scheduleContext.value?.teachers ?? []);
  const scheduleKnowledgePoints = computed(() => scheduleContext.value?.knowledgePoints ?? []);
  const generatePreview = computed(() => {
    const start = scheduleKnowledgePoints.value.findIndex((item) => item.id === generateForm.startKnowledgePointId);
    if (start < 0) return [];
    return scheduleKnowledgePoints.value.slice(start, start + Number(generateForm.sessionCount || 0));
  });
  const generateRemainingCount = computed(() => {
    const start = scheduleKnowledgePoints.value.findIndex((item) => item.id === generateForm.startKnowledgePointId);
    return start < 0 ? 1 : Math.max(scheduleKnowledgePoints.value.length - start, 1);
  });

  async function load() {
    loading.value = true;
    try {
      const tasks: Promise<void>[] = [];
      if (canReadSchedule) {
        tasks.push(listSessions(sessionParams()).then((page) => { sessions.value = page.items ?? []; }));
        tasks.push(listRules(selectedClassId.value || undefined).then((page) => { rules.value = page.items ?? []; }));
      }
      if (canReadLessonHours) {
        const params = selectedClassId.value ? { classId: selectedClassId.value } : {};
        tasks.push(listBalances(params).then((rows) => { balances.value = rows; }));
        tasks.push(listLedger(params).then((page) => { ledger.value = page.items ?? []; }));
      }
      if (canReadClasses) tasks.push(listClasses().then((page) => { classes.value = page.items ?? []; }));
      if (canReadLessonTypes) tasks.push(listLessonTypes().then((page) => { lessonTypes.value = page.items ?? []; }));
      await Promise.all(tasks);
      if (canReadAttendance && selectedSessionId.value && sessions.value.some((item) => item.id === selectedSessionId.value)) {
        await loadAttendance();
      }
    } finally {
      loading.value = false;
    }
  }

  async function loadAttendance() {
    if (!canReadAttendance || !selectedSessionId.value) {
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

  function normalizeAttendanceDeduct(row: AcademicOperationRecord) {
    if (!isBillableAttendance(row.draftStatus)) row.draftDeductHours = 0;
  }

  function normalizeCorrectionDeduct() {
    if (!isBillableAttendance(correctionForm.status)) correctionForm.deductHours = 0;
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

  function preferredLessonTypeId() {
    return lessonTypes.value.find((item) => item.active && item.name === '常规课')?.id
      ?? lessonTypes.value.find((item) => item.active && /(常规|正课)/.test(item.name))?.id
      ?? lessonTypes.value.find((item) => item.active)?.id
      ?? '';
  }

  function applyLessonTypeDefaults(target: { lessonTypeId: string; lessonHours: number }) {
    const lessonType = lessonTypes.value.find((item) => item.id === target.lessonTypeId);
    if (lessonType) target.lessonHours = Number(lessonType.defaultHours ?? 1);
  }

  async function loadScheduleContext(classId: string) {
    if (!classId) {
      scheduleContext.value = null;
      return null;
    }
    let context = scheduleContextCache.get(classId);
    if (!context) {
      context = await getScheduleContext(classId);
      scheduleContextCache.set(classId, context);
    }
    scheduleContext.value = context;
    return context;
  }

  async function openRule(row?: AcademicOperationRecord) {
    ruleEditingId.value = row?.id ?? '';
    Object.assign(ruleForm, row ? {
      classId: row.classId,
      teacherId: row.teacherId ?? '',
      lessonTypeId: row.lessonTypeId,
      weekday: row.weekday,
      startTime: clockOfMinute(row.startMinute),
      endTime: clockOfMinute(row.endMinute),
      effectiveFrom: dateOnlyValue(row.effectiveFrom),
      effectiveTo: row.effectiveTo ? dateOnlyValue(row.effectiveTo) : '',
      lessonHours: row.lessonHours,
      classroom: row.classroom ?? '',
      status: row.status,
    } : {
      ...baseRuleForm(),
      classId: selectedClassId.value || classes.value[0]?.id || '',
      lessonTypeId: preferredLessonTypeId(),
    });
    const context = await loadScheduleContext(ruleForm.classId);
    if (!ruleForm.teacherId) ruleForm.teacherId = context?.teachers?.[0]?.id ?? '';
    if (!row) applyLessonTypeDefaults(ruleForm);
    ruleVisible.value = true;
  }

  async function onRuleClassChange() {
    const context = await loadScheduleContext(ruleForm.classId);
    if (!context?.teachers?.some((item) => item.id === ruleForm.teacherId)) {
      ruleForm.teacherId = context?.teachers?.[0]?.id ?? '';
    }
  }

  function onRuleLessonTypeChange() {
    applyLessonTypeDefaults(ruleForm);
  }

  async function submitRule() {
    if (!ruleForm.classId || !ruleForm.teacherId || !ruleForm.lessonTypeId || !ruleForm.startTime || !ruleForm.endTime) {
      ElMessage.warning('请完整填写班级、教师、课型和时间');
      return;
    }
    const body = {
      classId: ruleForm.classId,
      teacherId: ruleForm.teacherId,
      lessonTypeId: ruleForm.lessonTypeId,
      weekday: Number(ruleForm.weekday),
      startMinute: minuteOfDay(ruleForm.startTime),
      endMinute: minuteOfDay(ruleForm.endTime),
      effectiveFrom: ruleForm.effectiveFrom,
      effectiveTo: ruleForm.effectiveTo || undefined,
      timezone: 'Asia/Shanghai',
      lessonHours: Number(ruleForm.lessonHours),
      classroom: compact(ruleForm.classroom),
      status: ruleForm.status,
    };
    if (ruleEditingId.value) await updateRule(ruleEditingId.value, body);
    else await createRule(body);
    ruleVisible.value = false;
    ElMessage.success('排课规则已保存');
    await load();
  }

  async function openGenerate() {
    const availableRules = rules.value.filter((item) => item.status === 'ACTIVE'
      && (!selectedClassId.value || item.classId === selectedClassId.value));
    const firstRule = availableRules[0];
    Object.assign(generateForm, {
      ruleId: firstRule?.id ?? '',
      from: dateRange.value[0],
      to: dateRange.value[1],
      startKnowledgePointId: '',
      sessionCount: 3,
    });
    await onGenerateRuleChange();
    generateVisible.value = true;
  }

  async function onGenerateRuleChange() {
    const rule = rules.value.find((item) => item.id === generateForm.ruleId);
    const context = await loadScheduleContext(rule?.classId ?? '');
    generateForm.startKnowledgePointId = context?.knowledgePoints?.[0]?.id ?? '';
    generateForm.sessionCount = Math.min(3, context?.knowledgePoints?.length ?? 0) || 1;
  }

  function onGenerateKnowledgeChange() {
    generateForm.sessionCount = Math.min(Number(generateForm.sessionCount || 1), generateRemainingCount.value);
  }

  async function submitGenerate() {
    if (!generateForm.ruleId || !generateForm.startKnowledgePointId || !generateForm.sessionCount) {
      ElMessage.warning('请选择排课规则、起始知识点和课次数');
      return;
    }
    const result = await generateSessions({
      ruleId: generateForm.ruleId,
      from: generateForm.from,
      to: generateForm.to,
      startKnowledgePointId: generateForm.startKnowledgePointId,
      sessionCount: Number(generateForm.sessionCount),
    });
    generateVisible.value = false;
    ElMessage.success(`生成 ${result.created} 节，跳过重复 ${result.skipped} 节`);
    await load();
  }

  async function openSession() {
    const startsAt = new Date();
    startsAt.setMinutes(0, 0, 0);
    startsAt.setHours(startsAt.getHours() + 1);
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1_000);
    Object.assign(sessionForm, baseSessionForm(), {
      classId: selectedClassId.value || classes.value[0]?.id || '',
      lessonTypeId: preferredLessonTypeId(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    const context = await loadScheduleContext(sessionForm.classId);
    sessionForm.teacherId = context?.teachers?.[0]?.id ?? '';
    sessionForm.knowledgePointId = context?.knowledgePoints?.[0]?.id ?? '';
    sessionForm.title = context?.knowledgePoints?.[0]?.name ?? '';
    applyLessonTypeDefaults(sessionForm);
    sessionVisible.value = true;
  }

  async function onSessionClassChange() {
    const context = await loadScheduleContext(sessionForm.classId);
    sessionForm.teacherId = context?.teachers?.[0]?.id ?? '';
    sessionForm.knowledgePointId = context?.knowledgePoints?.[0]?.id ?? '';
    sessionForm.title = context?.knowledgePoints?.[0]?.name ?? '';
  }

  function onSessionKnowledgeChange() {
    sessionForm.title = scheduleKnowledgePoints.value.find((item) => item.id === sessionForm.knowledgePointId)?.name ?? '';
  }

  function onSessionLessonTypeChange() {
    applyLessonTypeDefaults(sessionForm);
  }

  async function submitSession() {
    if (!sessionForm.classId || !sessionForm.teacherId || !sessionForm.lessonTypeId || !sessionForm.knowledgePointId
      || !sessionForm.title.trim() || !sessionForm.startsAt || !sessionForm.endsAt) {
      ElMessage.warning('请完整填写单次排课信息');
      return;
    }
    await createSession({
      classId: sessionForm.classId,
      teacherId: sessionForm.teacherId,
      lessonTypeId: sessionForm.lessonTypeId,
      knowledgePointId: sessionForm.knowledgePointId,
      title: sessionForm.title.trim(),
      kind: 'REGULAR',
      startsAt: new Date(sessionForm.startsAt).toISOString(),
      endsAt: new Date(sessionForm.endsAt).toISOString(),
      timezone: 'Asia/Shanghai',
      lessonHours: Number(sessionForm.lessonHours),
      classroom: compact(sessionForm.classroom),
    });
    sessionVisible.value = false;
    ElMessage.success('单次排课已创建');
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

  async function runReconciliation() {
    reconciliation.value = await reconcileHours({});
    if (reconciliation.value.passed) ElMessage.success('课时全量重算通过');
    else ElMessage.error('课时核对存在差异，请查看报告');
  }

  async function loadHours() {
    if (!canReadLessonHours) return;
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
    canConfirmAttendance, canCorrectAttendance, canManageLessonRecords,
    canManageLessonTypes, canManageSchedule, canReadAttendance, canReadCatalog,
    canReadLessonHours, canReadLessonTypes, canReadSchedule, canReconcile,
    cancelScheduledSession, classes, correctionForm, correctionVisible, dateRange, generateForm, generatePreview, generateVisible,
    ledger, lessonTypeEditingId, lessonTypeForm, lessonTypeVisible, lessonTypes, loading, openAdjustment,
    normalizeAttendanceDeduct, normalizeCorrectionDeduct, openAttendance, openCorrection, openGenerate,
    onGenerateKnowledgeChange, onGenerateRuleChange, onRuleClassChange, onRuleLessonTypeChange, onSessionClassChange,
    onSessionKnowledgeChange, onSessionLessonTypeChange, openLessonType, openRule, openSession, openSessionChange,
    reconciliation, ruleEditingId, ruleForm, ruleVisible, rules, saving, selectedClassId, selectedSession,
    generateRemainingCount,
    scheduleCourse, scheduleKnowledgePoints, scheduleTeachers,
    selectedSessionId, sessionChangeForm, sessionChangeMode, sessionChangeSource, sessionChangeVisible,
    sessionForm, sessionVisible, sessions, submitAdjustment, submitAttendance,
    submitCorrection, submitGenerate, submitLessonType, submitRule, submitSession, submitSessionChange,
    load, loadAttendance, runReconciliation,
  };
}
