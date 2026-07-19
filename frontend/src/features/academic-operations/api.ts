import {
  attendanceConfirm,
  attendanceCorrect,
  attendanceList,
} from '../../api/generated/academic-operations-attendance/academic-operations-attendance';
import {
  lessonCatalogCourseUnits,
  lessonCatalogCreateCourseUnit,
  lessonCatalogCreateLessonType,
  lessonCatalogLessonTypes,
} from '../../api/generated/academic-operations-catalog/academic-operations-catalog';
import {
  lessonHourAdjust,
  lessonHourBalances,
  lessonHourLedger,
  lessonHourReconcile,
} from '../../api/generated/academic-operations-lesson-hours/academic-operations-lesson-hours';
import {
  lessonScheduleCreateRule,
  lessonScheduleCreateSession,
  lessonScheduleCancel,
  lessonScheduleGenerate,
  lessonScheduleMakeup,
  lessonScheduleReschedule,
  lessonScheduleRules,
  lessonScheduleSessions,
} from '../../api/generated/academic-operations-schedule/academic-operations-schedule';
import { classesList } from '../../api/generated/classes/classes';
import { asGenerated, generatedData } from '../../api/generated-data';

export interface AcademicOperationRecord {
  id: string;
  studentId: string;
  studentName: string;
  username: string;
  realName: string;
  name: string;
  className: string;
  classroom: string;
  lessonTypeName: string;
  code: string;
  title: string;
  status: string;
  type: string;
  note: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
  confirmedAt: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  lessonHours: number;
  kind: string;
  defaultHours: number;
  deductHours: number;
  draftDeductHours: number;
  balance: number;
  amount: number;
  entryCount: number;
  version: number;
  revisionCount: number;
  weekday: number;
  startMinute: number;
  endMinute: number;
  countInStatistics: boolean;
  legacyBaseline: boolean;
  draftStatus: string;
  classGroup: AcademicOperationRecord;
  teacher: AcademicOperationRecord | null;
  lessonType: AcademicOperationRecord;
  unitTemplate: AcademicOperationRecord | null;
  session: AcademicOperationRecord;
  records: AcademicOperationRecord[];
  items: AcademicOperationRecord[];
  passed: boolean;
  confirmed: number;
  skipped: number;
  created: number;
}

type AcademicOperationBody = Record<string, unknown>;
type AcademicOperationPage = { items: AcademicOperationRecord[]; total: number };
const data = <T>(request: Promise<unknown>) => generatedData(asGenerated<T>(request));

export const listClasses = () => data<AcademicOperationPage>(classesList({ pageSize: 100 }));
export const listLessonTypes = () => data<AcademicOperationPage>(lessonCatalogLessonTypes({ pageSize: 100 }));
export const createLessonType = (body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonCatalogCreateLessonType(body as never));
export const listCourseUnits = () => data<AcademicOperationPage>(lessonCatalogCourseUnits({ pageSize: 100 }));
export const createCourseUnit = (body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonCatalogCreateCourseUnit(body as never));

export const listRules = (classId?: string) =>
  data<AcademicOperationPage>(lessonScheduleRules({ pageSize: 100, classId }));
export const createRule = (body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonScheduleCreateRule(body as never));
export const generateSessions = (body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonScheduleGenerate(body as never));
export const listSessions = (params: AcademicOperationBody = {}) =>
  data<AcademicOperationPage>(lessonScheduleSessions({ pageSize: 100, ...params }));
export const createSession = (body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonScheduleCreateSession(body as never));
export const cancelSession = (id: string, body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonScheduleCancel(id, body as never));
export const createMakeupSession = (id: string, body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonScheduleMakeup(id, body as never));
export const rescheduleSession = (id: string, body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonScheduleReschedule(id, body as never));

export const getAttendance = (sessionId: string) =>
  data<AcademicOperationRecord>(attendanceList(sessionId));
export const confirmAttendance = (sessionId: string, body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(attendanceConfirm(sessionId, body as never));
export const correctAttendance = (id: string, body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(attendanceCorrect(id, body as never));

export const listBalances = (params: AcademicOperationBody = {}) =>
  data<AcademicOperationRecord[]>(lessonHourBalances(params));
export const listLedger = (params: AcademicOperationBody = {}) =>
  data<AcademicOperationPage>(lessonHourLedger({ pageSize: 100, ...params }));
export const adjustHours = (body: AcademicOperationBody) =>
  data<AcademicOperationRecord>(lessonHourAdjust(body as never));
export const reconcileHours = (body: AcademicOperationBody = {}) =>
  data<AcademicOperationRecord>(lessonHourReconcile(body as never));
