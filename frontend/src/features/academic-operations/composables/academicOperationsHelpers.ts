export type AcademicTabAccess = {
  canReadSchedule: boolean;
  canReadAttendance: boolean;
  canReadLessonHours: boolean;
  canReadCatalog: boolean;
};

export function academicTab(value: unknown, access: AcademicTabAccess) {
  const requested = Array.isArray(value) ? value[0] : value;
  const key = typeof requested === 'string' ? requested : 'schedule';
  const tabs: Record<string, string> = {
    schedule: 'calendar', calendar: 'calendar', attendance: 'attendance', ledger: 'ledger', catalog: 'catalog',
  };
  const allowed = [
    access.canReadSchedule && 'calendar',
    access.canReadAttendance && 'attendance',
    access.canReadLessonHours && 'ledger',
    access.canReadCatalog && 'catalog',
  ].filter(Boolean) as string[];
  return tabs[key] && allowed.includes(tabs[key]) ? tabs[key] : allowed[0] ?? 'calendar';
}

export function baseRuleForm() {
  const [from, to] = defaultDateRange();
  return {
    classId: '', lessonTypeId: '', unitTemplateId: '', weekday: 1, startTime: '18:00', endTime: '20:00',
    effectiveFrom: from, effectiveTo: to, lessonHours: 1, classroom: '', status: 'ACTIVE',
  };
}

export function baseUnitForm() {
  return {
    code: '', courseId: '', lessonTypeId: '', category: '', stage: '', unitNo: 1,
    name: '', defaultHours: 1, teachingContent: '', status: 'ACTIVE',
  };
}

export function baseSessionForm() {
  return {
    classId: '', lessonTypeId: '', unitTemplateId: '', title: '', startsAt: '', endsAt: '', lessonHours: 1, classroom: '',
  };
}

export function baseSessionChangeForm() {
  return { startsAt: '', endsAt: '', classroom: '', reason: '' };
}

export function defaultDateRange() {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 30);
  return [dateOnly(from), dateOnly(to)];
}

export function minuteOfDay(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function clockOfMinute(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export function dateOnlyValue(value: string) {
  return String(value || '').slice(0, 10);
}

export function compact(value: string) {
  return value.trim() || undefined;
}

export function isBillableAttendance(status: string) {
  return ['PRESENT', 'LATE', 'MAKEUP'].includes(status);
}

function dateOnly(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
